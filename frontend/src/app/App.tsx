import "../styles/fonts.css";
import { useState } from "react";
import { LoginScreen } from "./components/auth/LoginScreen";
import { SignUpScreen } from "./components/auth/SignUpScreen";
import { ForgotPasswordScreen } from "./components/auth/ForgotPasswordScreen";
import { RegisterSuccessScreen } from "./components/auth/RegisterSuccessScreen";
import { AnalystDashboard } from "./components/analyst/AnalystDashboard";
import { SupervisorDashboard } from "./components/supervisor/SupervisorDashboard";
import { getSession, logout, type AuthUser } from "./auth";

type Screen = "login" | "signup" | "forgot" | "success" | "analyst" | "supervisor";

function resolveInitialScreen(): { screen: Screen; user: AuthUser | null } {
  const session = getSession();
  if (session) {
    return { screen: session.role === "supervisor" ? "supervisor" : "analyst", user: session };
  }
  return { screen: "login", user: null };
}

export default function App() {
  const initial = resolveInitialScreen();
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [user, setUser]     = useState<AuthUser | null>(initial.user);

  const handleLogin = (role: "analyst" | "supervisor") => {
    const session = getSession();
    setUser(session);
    setScreen(role === "supervisor" ? "supervisor" : "analyst");
  };

  // After register → show success screen first
  const handleSignUpSuccess = (role: "analyst" | "supervisor") => {
    const session = getSession();
    setUser(session);
    setScreen("success");
  };

  // From success screen → go to dashboard
  const handleContinueToDashboard = () => {
    if (!user) return;
    setScreen(user.role === "supervisor" ? "supervisor" : "analyst");
  };

  const handleLogout = () => {
    logout();
    setUser(null);
    setScreen("login");
  };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", minHeight: '100vh' }}>
      {screen === "login" && (
        <LoginScreen
          onLogin={handleLogin}
          onSignUp={() => setScreen("signup")}
          onForgot={() => setScreen("forgot")}
        />
      )}
      {screen === "signup" && (
        <SignUpScreen
          onBack={() => setScreen("login")}
          onSuccess={handleSignUpSuccess}
        />
      )}
      {screen === "forgot" && (
        <ForgotPasswordScreen onBack={() => setScreen("login")} />
      )}
      {screen === "success" && user && (
        <RegisterSuccessScreen
          user={user}
          onContinue={handleContinueToDashboard}
        />
      )}
      {screen === "analyst" && (
        <AnalystDashboard onLogout={handleLogout} user={user} />
      )}
      {screen === "supervisor" && (
        <SupervisorDashboard onLogout={handleLogout} user={user} />
      )}
    </div>
  );
}
