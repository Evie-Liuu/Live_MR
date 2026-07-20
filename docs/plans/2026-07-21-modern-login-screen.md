# Modern Educational Login Screen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the basic role selection landing page in the Live_MR frontend with a stunning, modern, and educational split-screen login page based on `modern_educational_login_screen_v2.png`, featuring tab-based teacher login and student room join capabilities.

**Architecture:** Create a new React component `LoginScreen` along with its separate stylesheet `LoginScreen.css`. Update `App.tsx` to render `LoginScreen` instead of `RoleSelect` as the initial screen, handling both `onHost` (Teacher) and direct `onStudentJoin` (Student) actions.

**Tech Stack:** React 19, TypeScript, Vanilla CSS with custom brand colors, Material Symbols.

---

### Task 1: Create LoginScreen CSS
Define all layout, typographic, color, and animation classes matching the design mockup in a new CSS file.

**Files:**
- Create: `frontend/src/components/LoginScreen.css`

**Step 1: Write CSS rules**
Write the CSS specifying split-screen layout, teacher/student tabs, orange/teal brand styling, round pill inputs, peach icon backgrounds, and custom checkbox styling.

**Step 2: Commit**
```bash
git add frontend/src/components/LoginScreen.css
git commit -m "style: add styles for the modern educational login screen"
```

---

### Task 2: Create LoginScreen Component
Create the React component representing the login page layout with tab switches between Teacher and Student.

**Files:**
- Create: `frontend/src/components/LoginScreen.tsx`

**Step 1: Write LoginScreen.tsx**
Create the component with:
- Imports for React state, `joinRequest` API, CSS, and the illustration asset.
- Tab toggling state.
- Form inputs for Email/Password (Teacher) and Room ID/Student Name (Student).
- Smooth interactions and validation before calling actions.

**Step 2: Commit**
```bash
git add frontend/src/components/LoginScreen.tsx
git commit -m "feat: implement LoginScreen component with teacher/student tabs"
```

---

### Task 3: Update App.tsx and App.css
Integrate the new LoginScreen component into `App.tsx` and adjust global CSS rules to ensure correct full-screen styling.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`

**Step 1: Edit App.tsx**
- Import `LoginScreen` instead of `RoleSelect`.
- Change `select-role` screen rendering to use `<LoginScreen onHost={handleHost} onStudentJoin={(roomId, requestId, name) => setState({ screen: 'student-waiting', roomId, requestId, name })} />`.

**Step 2: Edit App.css**
- Locate the `.app:has(...)` selector and add `.login-screen-container` to the list of selectors that strip padding and enable full-screen layout.

**Step 3: Commit**
```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: integrate LoginScreen into App component and update container styles"
```

---

### Task 4: Verification and Run Tests
Verify compile correctness, check formatting/lint errors, and run vitest tests.

**Files:**
- Verify compilation
- Run tests

**Step 1: Compile application**
Run: `npm run build` in `frontend` folder to make sure there are no TypeScript errors.

**Step 2: Run unit tests**
Run: `npm run test` in `frontend` folder to ensure the existing tests remain fully green.

**Step 3: Commit**
```bash
git commit --allow-empty -m "test: verify build and tests pass successfully"
```
