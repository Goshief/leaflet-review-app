import { NextResponse } from "next/server";

export type SafeErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export type SafeErrorOptions = {
  status: number;
  code: SafeErrorCode;
  message: string;
  requestId?: string;
  cause?: unknown;
  logContext?: Record<string, unknown>;
};

function toLogMessage(cause: unknown): string | undefined {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return undefined;
}

export function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeErrorJson({
  status,
  code,
  message,
  requestId,
  cause,
  logContext,
}: SafeErrorOptions) {
  const rid = requestId ?? makeRequestId();

  console.error("[api-error]", {
    request_id: rid,
    code,
    status,
    message,
    cause: toLogMessage(cause),
    ...logContext,
  });

  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
      },
      request_id: rid,
    },
    { status }
  );
}
