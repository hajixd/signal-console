import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
  type PutObjectCommandInput,
  S3Client,
  type GetObjectCommandOutput
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const DEFAULT_R2_TIMEOUT_MS = 20_000;
const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 64 * 1024 * 1024;

let cachedClient: S3Client | null = null;

function trim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function operationTimeoutMs(): number {
  const configured = Number(process.env.R2_OPERATION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 250 ? configured : DEFAULT_R2_TIMEOUT_MS;
}

export function missingR2Env(): string[] {
  return ["R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter((key) => !trim(process.env[key]));
}

export function r2Configured(): boolean {
  return missingR2Env().length === 0;
}

export function r2BucketName(): string {
  const bucket = trim(process.env.R2_BUCKET);
  if (!bucket) throw new Error(`R2 is not configured. Missing: ${missingR2Env().join(", ")}`);
  return bucket;
}

export function r2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const endpoint = trim(process.env.R2_ENDPOINT);
  const accessKeyId = trim(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = trim(process.env.R2_SECRET_ACCESS_KEY);

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(`R2 is not configured. Missing: ${missingR2Env().join(", ")}`);
  }

  cachedClient = new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    endpoint,
    region: "auto"
  });
  return cachedClient;
}

export async function withR2Timeout<T>(operation: Promise<T>, label: string, timeoutMs = operationTimeoutMs()): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizedPrefix(): string {
  const prefix = trim(process.env.R2_PREFIX);
  return prefix ? prefix.replace(/^\/+|\/+$/g, "") : "";
}

export function r2ObjectKey(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/g, "");
  const prefix = normalizedPrefix();
  return prefix ? `${prefix}/${normalized}` : normalized;
}

async function bodyToText(body: GetObjectCommandOutput["Body"]): Promise<string> {
  const transformable = body as { transformToString?: () => Promise<string> } | undefined;
  if (!body) return "";
  if (transformable?.transformToString) return transformable.transformToString();

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isNotFoundError(error: unknown): boolean {
  const record = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return record?.$metadata?.httpStatusCode === 404 || record?.name === "NoSuchKey" || record?.name === "NotFound";
}

export async function r2HeadBucket(): Promise<void> {
  await withR2Timeout(r2Client().send(new HeadBucketCommand({ Bucket: r2BucketName() })), "R2 bucket check");
}

export async function r2HeadObject(relativePath: string): Promise<{ contentLength?: number; eTag?: string; lastModified?: Date } | null> {
  try {
    const result = await withR2Timeout(
      r2Client().send(new HeadObjectCommand({ Bucket: r2BucketName(), Key: r2ObjectKey(relativePath) })),
      `R2 object head ${relativePath}`
    );
    return {
      contentLength: result.ContentLength,
      eTag: result.ETag,
      lastModified: result.LastModified
    };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function r2GetText(relativePath: string): Promise<string | null> {
  try {
    const result = await withR2Timeout(
      r2Client().send(new GetObjectCommand({ Bucket: r2BucketName(), Key: r2ObjectKey(relativePath) })),
      `R2 object read ${relativePath}`
    );
    return bodyToText(result.Body);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function r2GetTextRange(
  relativePath: string,
  range: { end?: number; start?: number; suffixBytes?: number }
): Promise<string | null> {
  try {
    const rangeHeader =
      typeof range.suffixBytes === "number"
        ? `bytes=-${Math.max(0, Math.round(range.suffixBytes))}`
        : `bytes=${Math.max(0, Math.round(range.start ?? 0))}-${typeof range.end === "number" ? Math.max(0, Math.round(range.end)) : ""}`;
    const result = await withR2Timeout(
      r2Client().send(new GetObjectCommand({ Bucket: r2BucketName(), Key: r2ObjectKey(relativePath), Range: rangeHeader })),
      `R2 object range read ${relativePath}`
    );
    return bodyToText(result.Body);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function r2GetTailText(relativePath: string, byteCount: number): Promise<string | null> {
  return r2GetTextRange(relativePath, { suffixBytes: Math.max(1, Math.round(byteCount)) });
}

export async function r2PutText(relativePath: string, body: string, contentType = "application/json; charset=utf-8"): Promise<void> {
  await r2PutObject(relativePath, body, { contentType });
}

export async function r2PutObject(
  relativePath: string,
  body: PutObjectCommandInput["Body"],
  options: { contentLength?: number; contentType?: string; multipart?: boolean } = {}
): Promise<void> {
  const params: PutObjectCommandInput = {
    Body: body,
    Bucket: r2BucketName(),
    ContentLength: options.contentLength,
    ContentType: options.contentType,
    Key: r2ObjectKey(relativePath)
  };
  const shouldUseMultipart = options.multipart || (options.contentLength ?? 0) >= MULTIPART_UPLOAD_THRESHOLD_BYTES;

  if (shouldUseMultipart) {
    const upload = new Upload({
      client: r2Client(),
      leavePartsOnError: false,
      params,
      partSize: 32 * 1024 * 1024,
      queueSize: 3
    });
    await withR2Timeout(upload.done(), `R2 multipart object write ${relativePath}`);
    return;
  }

  await withR2Timeout(
    r2Client().send(new PutObjectCommand(params)),
    `R2 object write ${relativePath}`
  );
}

function copySourceForKey(key: string): string {
  return `${r2BucketName()}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function r2AppendText(relativePath: string, text: string, contentType = "text/plain; charset=utf-8"): Promise<void> {
  if (!text) return;
  const existing = await r2HeadObject(relativePath);
  if (!existing?.contentLength) {
    await r2PutText(relativePath, text, contentType);
    return;
  }

  if (existing.contentLength < MIN_MULTIPART_PART_BYTES) {
    const current = await r2GetText(relativePath);
    await r2PutText(relativePath, `${current ?? ""}${text}`, contentType);
    return;
  }

  const bucket = r2BucketName();
  const key = r2ObjectKey(relativePath);
  const upload = await withR2Timeout(
    r2Client().send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        ContentType: contentType,
        Key: key
      })
    ),
    `R2 append multipart create ${relativePath}`
  );
  if (!upload.UploadId) throw new Error(`R2 multipart upload failed to start for ${relativePath}`);

  try {
    const copied = await withR2Timeout(
      r2Client().send(
        new UploadPartCopyCommand({
          Bucket: bucket,
          CopySource: copySourceForKey(key),
          CopySourceRange: `bytes=0-${existing.contentLength - 1}`,
          Key: key,
          PartNumber: 1,
          UploadId: upload.UploadId
        })
      ),
      `R2 append multipart copy ${relativePath}`
    );
    const appended = await withR2Timeout(
      r2Client().send(
        new UploadPartCommand({
          Body: text,
          Bucket: bucket,
          Key: key,
          PartNumber: 2,
          UploadId: upload.UploadId
        })
      ),
      `R2 append multipart upload ${relativePath}`
    );
    await withR2Timeout(
      r2Client().send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          MultipartUpload: {
            Parts: [
              { ETag: copied.CopyPartResult?.ETag, PartNumber: 1 },
              { ETag: appended.ETag, PartNumber: 2 }
            ]
          },
          UploadId: upload.UploadId
        })
      ),
      `R2 append multipart complete ${relativePath}`
    );
  } catch (error) {
    await withR2Timeout(
      r2Client().send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: upload.UploadId })),
      `R2 append multipart abort ${relativePath}`
    ).catch(() => undefined);
    throw error;
  }
}

export async function r2DeleteObject(relativePath: string): Promise<void> {
  await withR2Timeout(
    r2Client().send(new DeleteObjectCommand({ Bucket: r2BucketName(), Key: r2ObjectKey(relativePath) })),
    `R2 object delete ${relativePath}`
  );
}

export async function r2ListKeys(prefix = "", limit = 1000): Promise<string[]> {
  const normalizedLimit = Math.max(1, Math.min(1000, Math.round(limit)));
  const result = await withR2Timeout(
    r2Client().send(
      new ListObjectsV2Command({
        Bucket: r2BucketName(),
        MaxKeys: normalizedLimit,
        Prefix: prefix ? r2ObjectKey(prefix) : normalizedPrefix() || undefined
      })
    ),
    `R2 object list ${prefix || "/"}`
  );
  return (result.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key));
}
