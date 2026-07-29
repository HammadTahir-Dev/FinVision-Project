Act as an expert Senior UI/UX Designer specializing in FinTech applications. Design a comprehensive, production-ready GUI for an AI-powered financial decision support system named "FinVision". 

The application has two distinct user roles: "Financial Analyst" and "System Supervisor". The interface should look highly professional, trustworthy, and modern—utilizing a clean layout with high data density but excellent scannability.

### BRANDING & COLOR PALETTE (Strict Adherence to FinVision.png)
- Primary Color: Deep Navy Blue (for primary navigation, active states, and headers).
- Accent Color: Bright Golden Yellow / Amber (used sparingly for trend lines, notifications, and primary CTA highlights).
- Neutral Backgrounds: Crisp pure white (#FFFFFF) and ultra-light gray (#F8F9FA) for content panels.
- Typography: Clean, modern sans-serif (e.g., Inter, Roboto, or SF Pro).
- Logo Placement: 
  * On Authentication screens: Center the full corporate logo with its tagline "Finance Made Bright with AI Insight".
  * On Dashboard screens: Place a compact version (Circular emblem + "FinVision" wordmark) in the top-left corner on a white background panel to ensure full contrast and visibility.

---

### PHASE 1: AUTHENTICATION & ACCESS CONTROL FLOW
Generate consistent light-themed onboarding screens using a split-screen layout (Left side: clean minimalist branding graphic; Right side: interactive form card).
1. Login Screen: Fields for Email/Username, Password (with toggle visibility), a "Remember Me" checkbox, a prominent Navy Blue "Login" button, "Forgot Password?" link, and a "Sign Up" secondary action.
2. Sign-Up Screen: Fields for Full Name, Corporate Email, Password (with visual security criteria checklist), and a Role Selection dropdown ("Financial Analyst" or "System Supervisor").
3. Forgot Password Screen: Input field for Email and a "Send Recovery Link" action button with a "Back to Login" navigation link.

---

### PHASE 2: FINANCIAL ANALYST DASHBOARD (Multi-Tab Workspace)
Create a unified workspace featuring a persistent left-hand Sidebar Navigation (compact white background) containing the compact FinVision logo and four distinct tabs:

1. [Tab 1] Upload Data (Source Management Hub)
   - Left Pane: Large drag-and-drop zone optimized for CSV, Excel, and PDF uploads. Includes an "ERP Integration / External API Link" configuration panel.
   - Right Pane: A data table/grid listing uploaded sources showing: Source Icon, File Name, File Size, Upload Date, and Status Badge ("Processing", "Failed", or Green "Verified & Indexed").
   - Feature: A checkbox next to each file to let the user select/deselect it as active context for the AI.

2. [Tab 2] Analyze & Chat (NotebookLM Inspired Contextual Chat)
   - Three-Column Layout:
     * Column 1 (Left, Narrow): "Active Sources" panel showing a summary of the selected files providing context.
     * Column 2 (Center, Wide): Scrollable conversational AI stream. At the bottom, a sleek input bar containing a text field, a [Microphone Icon] for voice querying, and a [Send Arrow].
     * Column 3 (Right, Medium): "Dynamic Insights & Source Citations" panel. When an AI response is generated, this panel updates with clickable text snippet cards or raw data row previews linking directly back to the source document.

3. [Tab 3] Forecast (Predictive Analytics Canvas)
   - Top Control Bar: Dropdowns for Target Metric (Revenue, Net Profit, Operational Costs), Time Horizon slider (3 Months to 2 Years), and a prominent "Generate Forecast" button.
   - Main Center Panel: A large, beautiful interactive line chart showing historical financial data transitioning into a dotted-line forecasting zone with shaded error margins representing "Best Case", "Worst Case", and "Expected Case" scenarios.
   - Right Sidebar: Key Performance Indicator (KPI) cards summarizing calculated metrics like "Projected YoY Growth" and "Estimated Profit Margin".

4. [Tab 4] My Reports (Automated Export Engine)
   - Layout: A clean document staging environment.
   - Content: A grid of saved financial reports. Each card shows a document preview thumbnail, title, creation timestamp, and a clear horizontal action bar with two explicit primary buttons: [Export PDF] and [Export Excel].

---

### PHASE 3: SYSTEM SUPERVISOR DASHBOARD (Backend Control Center)
Generate a completely alternate dashboard view tailored for administrative configuration, using a grid configuration layout:
1. Model Configuration Section: Dropdown selectors to change the active Local LLM (e.g., Mistral, Llama) and Embedding Models. Includes real-time performance tracking graphs (Latency vs. Token usage).
2. AI / RAG Parameters Control Panel: Interactive slider controls to fine-tune system execution metrics including Temperature, Max Tokens, and Chunk Size (k-value retrieval depth). Includes a mini-sandbox testing console to run prompt queries on the fly.
3. System Monitoring & Database Security Panel: A dashboard display showing cloud PostgreSQL database health, automated database backup schedules, system event access logs, and a manual [Trigger System Backup] button.