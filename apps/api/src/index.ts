import { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app";

export const app = createApp();

type CloudFunctionRequest = IncomingMessage & {
  rawBody?: Buffer;
  body?: Buffer | string | Record<string, unknown>;
  originalUrl?: string;
  protocol?: string;
};

type CloudFunctionResponse = ServerResponse & {
  status(code: number): CloudFunctionResponse;
  send(body: Buffer): void;
};

export async function driftApi(req: CloudFunctionRequest, res: CloudFunctionResponse): Promise<void> {
  const request = await toWebRequest(req);
  const response = await app.fetch(request);
  await sendWebResponse(res, response);
}

export async function toWebRequest(req: CloudFunctionRequest): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }

  const url = absoluteUrl(req, headers);
  const init: RequestInit = {
    method: req.method || "GET",
    headers,
  };

  if (!["GET", "HEAD"].includes(init.method!.toUpperCase())) {
    init.body = await requestBody(req);
  }

  return new Request(url, init);
}

function absoluteUrl(req: CloudFunctionRequest, headers: Headers): string {
  const rawUrl = req.originalUrl || req.url || "/";
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  const host = headers.get("host") || "localhost";
  const protocol = req.protocol || headers.get("x-forwarded-proto") || "http";
  return `${protocol}://${host}${rawUrl}`;
}

async function requestBody(req: CloudFunctionRequest): Promise<BodyInit | undefined> {
  if (Buffer.isBuffer(req.rawBody)) {
    return bufferToBodyInit(req.rawBody);
  }
  if (Buffer.isBuffer(req.body)) {
    return bufferToBodyInit(req.body);
  }
  if (req.body && typeof req.body === "object" && !isReadable(req.body)) {
    return JSON.stringify(req.body);
  }
  if (typeof req.body === "string") {
    return req.body;
  }
  if (isReadable(req)) {
    return bufferToBodyInit(await readNodeStream(req));
  }
  return undefined;
}

function bufferToBodyInit(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(buffer.byteLength);
  body.set(buffer);
  return body;
}

function isReadable(value: unknown): value is NodeJS.ReadableStream {
  return !!value && typeof (value as { on?: unknown }).on === "function";
}

function readNodeStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function sendWebResponse(res: CloudFunctionResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (response.status === 204) {
    res.end();
    return;
  }
  res.send(Buffer.from(await response.arrayBuffer()));
}
