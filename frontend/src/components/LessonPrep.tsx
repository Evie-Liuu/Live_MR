// 佔位元件：真正的實作在 Task 11，會整個覆蓋這個檔案。
// 這裡先給出符合 App.tsx 期待的最小型別，讓 tsc/build 通過。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function LessonPrep(_: { teacherUid: string; institutionId?: string; onBack: () => void }) {
  return null;
}
