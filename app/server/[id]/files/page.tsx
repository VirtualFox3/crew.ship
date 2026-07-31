import { FileManager } from "@/components/file-manager";

export const dynamic = "force-dynamic";

export default async function FilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Files</h2>
        <p className="mt-1 text-sm text-ink-400">
          The whole server directory. Edit configs in place — no FTP client needed.
        </p>
      </div>
      <FileManager serverId={id} />
    </div>
  );
}
