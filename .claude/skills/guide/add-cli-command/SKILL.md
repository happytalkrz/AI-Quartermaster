---
name: add-cli-command
description: This skill should be used when the user asks to "add CLI command", "명령어 추가", "add command", "CLI 추가", or mentions cli.ts, parseArgs, printHelp, bin/aqm.
level: 3
---

# CLI 명령어 추가

## CLI 구조

진입점: `src/cli.ts`
- `parseArgs()` — argv 파싱
- `main()` — command 라우팅
- 각 command는 `xxxCommand(args)` 함수

## 추가 절차

### 1. CliArgs에 필요한 옵션 추가

```typescript
interface CliArgs {
  command?: string;
  // ... 기존
  newOption?: string;  // 추가
}
```

### 2. parseArgs()에 파싱 로직 추가

```typescript
} else if (argv[i] === "--new-option" && argv[i + 1]) {
  result.newOption = argv[++i];
}
```

### 3. Command 함수 작성

```typescript
async function newCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const config = loadConfig(aqRoot);
  // ...
}
```

### 4. main()에 라우팅 추가

```typescript
} else if (command === "new-command") {
  await newCommand(args);
}
```

### 5. printHelp()에 설명 추가

### 6. bin/aqm에 필요 시 쉘 래퍼 추가

`bin/aqm`은 daemon 모드(start/stop/restart/logs)를 처리하는 bash 래퍼.
단순 명령은 `npx tsx src/cli.ts`로 직접 전달.

## 규칙

- config 로드는 command 함수 안에서 (전역 X)
- 에러 시 `process.exit(1)` + 사용자 친화적 메시지
- `--dry-run` 플래그 존중
