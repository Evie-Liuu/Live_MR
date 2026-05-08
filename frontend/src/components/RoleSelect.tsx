import teacherIcon from "../assets/teacher_role.png";
import studentIcon from "../assets/student_role.png";

interface RoleSelectProps {
  onHost: () => void;
  onStudent: () => void;
}

export default function RoleSelect({ onHost, onStudent }: RoleSelectProps) {
  return (
    <div className="role-select-screen">
      <h1 className="role-select-title">
        <span className="role-title-highlight-orange">請選擇你的</span>
        <span className="role-title-highlight-teal">角色</span>
      </h1>

      <div className="role-cards-container">
        {/* Teacher Card */}
        <div className="role-card">
          <div className="role-icon-wrapper">
            <img src={teacherIcon} alt="Teacher" />
          </div>
          <h2 className="role-card-label">我是老師</h2>
          <button className="role-select-btn teacher" onClick={onHost}>
            選擇老師
          </button>
        </div>

        {/* Student Card */}
        <div className="role-card">
          <div className="role-icon-wrapper">
            <img src={studentIcon} alt="Student" />
          </div>
          <h2 className="role-card-label">我是學生</h2>
          <button className="role-select-btn student" onClick={onStudent}>
            選擇學生
          </button>
        </div>
      </div>
    </div>
  );
}
