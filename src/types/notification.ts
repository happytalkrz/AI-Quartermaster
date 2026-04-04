/** Job 실패 시 webhook으로 전송할 정보 */
export interface WebhookPayload {
  repo: string;
  issueNumber: number;
  error: string;
  errorCategory?: string;
  prUrl?: string;
}

/** Discord/Slack 호환 webhook 메시지 형식 */
export interface WebhookMessage {
  text?: string;        // Slack 호환
  content?: string;     // Discord 호환
}