import { createInterface, Interface } from "readline";
import { Readable, Writable } from "stream";

export interface PromptOptions {
  input?: Readable;
  output?: Writable;
}

/**
 * 텍스트 입력을 받는 프롬프트
 */
export async function askQuestion(prompt: string, options?: PromptOptions): Promise<string> {
  const rl = createInterface({
    input: options?.input ?? process.stdin,
    output: options?.output ?? process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * y/n 확인 프롬프트 (대소문자 무관, 기본값 y)
 */
export async function askConfirm(prompt: string, options?: PromptOptions): Promise<boolean> {
  const answer = await askQuestion(`${prompt} (y/N): `, options);
  return /^y(?:es)?$/i.test(answer);
}

/**
 * 선택지 프롬프트 (0-based 인덱스 반환)
 */
export async function askChoice(prompt: string, choices: string[], options?: PromptOptions): Promise<number> {
  if (choices.length === 0) {
    throw new Error("choices 배열이 비어있습니다");
  }

  const choiceText = choices
    .map((choice, index) => `  ${index + 1}. ${choice}`)
    .join("\n");

  const fullPrompt = `${prompt}\n${choiceText}\n선택하세요 (1-${choices.length}): `;

  while (true) {
    const answer = await askQuestion(fullPrompt, options);
    const choice = parseInt(answer, 10);

    if (isNaN(choice) || choice < 1 || choice > choices.length) {
      const output = options?.output ?? process.stdout;
      output.write(`잘못된 선택입니다. 1-${choices.length} 사이의 숫자를 입력하세요.\n`);
      continue;
    }

    return choice - 1; // 0-based 인덱스로 변환
  }
}

/**
 * 테스트용 유틸리티: 미리 정의된 답변으로 모킹
 */
export class MockPrompt {
  private responses: string[];
  private index = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  createOptions(): PromptOptions {
    const input = new Readable({
      read() {
        if (this.index < this.responses.length) {
          this.push(this.responses[this.index++] + "\n");
        } else {
          this.push(null);
        }
      }.bind(this),
    });

    const output = new Writable({
      write(_chunk, _encoding, callback) {
        // Silent output for testing
        callback();
      },
    });

    return { input, output };
  }

  hasMoreResponses(): boolean {
    return this.index < this.responses.length;
  }
}