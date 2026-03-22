export type AppState =
  | { screen: 'select-role' }
  | { screen: 'host-lobby'; roomId: string; hostToken: string; livekitToken: string }
  | { screen: 'host-session'; roomId: string; livekitToken: string }
  | { screen: 'student-join'; roomId: string }
  | { screen: 'student-waiting'; roomId: string; requestId: string; name: string }
  | { screen: 'student-session'; roomId: string; token: string; name: string }
  | { screen: 'student-rejected'; roomId: string }
  | { screen: 'error'; message: string };
