import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const threshold = formData.get("threshold") ? String(formData.get("threshold")) : "220";

    if (!file) {
      return Response.json({ error: "No image file provided" }, { status: 400 });
    }

    const tempDir = join(process.cwd(), ".tmp-plot");
    await mkdir(tempDir, { recursive: true }).catch(() => undefined);

    const tempPath = join(tempDir, `plot-${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`);
    const bytes = await file.arrayBuffer();
    await writeFile(tempPath, Buffer.from(bytes));

    const scriptPath = join(process.cwd(), "scripts", "opencv_autoresize.py");
    const command = `python "${scriptPath}" "${tempPath}" ${threshold}`;

    const { stdout, stderr } = await execAsync(command, { timeout: 15000 });

    // Clean up temporary file
    await unlink(tempPath).catch(() => undefined);

    if (!stdout.trim()) {
      return Response.json({ error: stderr || "OpenCV process returned no output" }, { status: 500 });
    }

    const result = JSON.parse(stdout.trim());
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenCV auto-resize failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
