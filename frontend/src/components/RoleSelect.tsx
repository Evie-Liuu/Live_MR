interface RoleSelectProps {
  onHost: () => void;
  onStudent: () => void;
}

export default function RoleSelect({ onHost, onStudent }: RoleSelectProps) {
  return (
    <div className="role-select">
      <h1>Live MR</h1>
      <p>請選擇你的角色</p>
      <div className="role-buttons">
        <button className="role-btn host-btn" onClick={onHost}>
          我是老師
        </button>
        <button className="role-btn student-btn" onClick={onStudent}>
          我是學生
        </button>
      </div>
    </div>
  );
}
