"""
routers/auth.py — Authentication endpoints for FinVision.

Endpoints:
  POST /auth/register   → create new account
  POST /auth/login      → get JWT token
  GET  /auth/me         → get current user info
  POST /auth/logout     → client-side token discard (stateless)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, EmailStr
from typing import Optional
import logging

from database import get_db
from config import get_settings
from models.db_models import User, UserRole, SystemLog, LogLevel

logger   = logging.getLogger(__name__)
settings = get_settings()
router   = APIRouter(prefix="/auth", tags=["Authentication"])

# ── Password hashing ──────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name:     str
    email:    EmailStr
    password: str



class LoginResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user_id:      int
    name:         str
    email:        str
    role:         str


class UserResponse(BaseModel):
    id:         int
    name:       str
    email:      str
    role:       str
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    payload = data.copy()
    expire  = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload.update({"exp": expire})
    if "sub" in payload:
        payload["sub"] = str(payload["sub"])
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db:    Session = Depends(get_db),
) -> User:
    """
    Dependency: decodes JWT, fetches user from DB.
    Use in any protected route: user = Depends(get_current_user)
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        sub = payload.get("sub")
        if sub is None:
            raise credentials_exception
        user_id = int(sub)
    except (JWTError, ValueError):
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise credentials_exception
    return user


def require_supervisor(current_user: User = Depends(get_current_user)) -> User:
    """Dependency: ensures the current user is a supervisor."""
    if current_user.role != UserRole.supervisor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Supervisor access required",
        )
    return current_user


def log_event(db: Session, event: str, level: LogLevel, user: Optional[User] = None, metadata: dict = None):
    """Helper to write a system log entry."""
    try:
        entry = SystemLog(
            event=event,
            level=level,
            user_id=user.id if user else None,
            user_email=user.email if user else "system",
            extra_data=metadata,
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        logger.warning(f"Failed to write system log: {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user. Returns a JWT token immediately."""

    # Check duplicate email
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    # Validate password strength
    if len(payload.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters.",
        )

    # Create user
    user = User(
        name=payload.name.strip(),
        email=payload.email.lower().strip(),
        password_hash=hash_password(payload.password),
        role=UserRole.analyst,   # public signup is always analyst; supervisors are promoted manually
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Log event
    log_event(db, f"New user registered: {user.email} [{user.role}]", LogLevel.success, user)

    token = create_access_token({"sub": user.id, "role": user.role})
    return LoginResponse(
        access_token=token,
        user_id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
    )


@router.post("/login", response_model=LoginResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Login with email + password. Returns JWT token.
    Frontend sends: { username: email, password: password }
    (OAuth2PasswordRequestForm uses 'username' field for email)
    """
    user = db.query(User).filter(User.email == form.username.lower().strip()).first()

    if not user or not verify_password(form.password, user.password_hash):
        log_event(db, f"Failed login attempt: {form.username}", LogLevel.warn)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact your supervisor.",
        )

    log_event(db, f"User logged in: {user.email}", LogLevel.success, user)

    token = create_access_token({"sub": user.id, "role": user.role})
    return LoginResponse(
        access_token=token,
        user_id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Returns the currently authenticated user's profile."""
    return current_user


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    JWT is stateless — actual logout happens client-side by deleting the token.
    This endpoint just logs the event for the audit trail.
    """
    log_event(db, f"User logged out: {current_user.email}", LogLevel.info, current_user)
    return {"message": "Logged out successfully. Please delete your token client-side."}
