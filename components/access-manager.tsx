"use client";

import { useState } from "react";
import { Crown, Trash2, UserPlus } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import type { AccessRole } from "@/lib/types";

interface Member {
  user_id: string;
  role: AccessRole;
  created_at: string;
  profiles: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

const ROLE_BLURB: Record<string, string> = {
  admin: "Everything except deleting the server.",
  moderator: "Console, players, plugins and files. No settings changes.",
  viewer: "Read-only: status, console output and player list.",
};

export function AccessManager({
  serverId,
  initialMembers,
  ownerName,
  isOwner,
}: {
  serverId: string;
  initialMembers: Member[];
  ownerName: string;
  isOwner: boolean;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<AccessRole>("moderator");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy("invite");
    setError(null);
    try {
      await api(`/api/servers/${serverId}/access`, {
        method: "POST",
        json: { username: username.trim(), role },
      });
      // The API returns only a confirmation; re-read to get the joined profile.
      const { members } = await api<{ members: Member[] }>(
        `/api/servers/${serverId}/access`,
      );
      setMembers(members);
      setUsername("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(member: Member) {
    setBusy(member.user_id);
    try {
      await api(`/api/servers/${serverId}/access?user=${member.user_id}`, {
        method: "DELETE",
      });
      setMembers((cur) => cur.filter((m) => m.user_id !== member.user_id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="Who can manage this server"
          description="Invite friends by their Pack.Host username. Free, like everything else."
        />

        <div className="flex items-center gap-3 border-b border-ink-800 px-4 py-3">
          <Crown className="size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{ownerName}</p>
            <p className="text-xs text-ink-500">Owner — full control, including deletion</p>
          </div>
          <Badge tone="amber">Owner</Badge>
        </div>

        {members.length ? (
          <ul className="divide-y divide-ink-800">
            {members.map((member) => (
              <li key={member.user_id} className="flex items-center gap-3 px-4 py-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-800 text-xs font-semibold text-ink-300">
                  {(member.profiles?.username ?? "?").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.profiles?.username ?? "unknown"}
                  </p>
                  <p className="text-xs text-ink-500">{ROLE_BLURB[member.role]}</p>
                </div>
                <Badge tone={member.role === "admin" ? "grass" : "neutral"}>
                  {member.role}
                </Badge>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === member.user_id}
                    onClick={() => revoke(member)}
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    title="Remove access"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<UserPlus className="size-6" />}
              title="Just you so far"
              description="Add someone below so they can help run the server."
            />
          </div>
        )}
      </Card>

      {isOwner && (
        <Card>
          <CardHeader title="Invite someone" />
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3 p-5">
            <Field label="Pack.Host username" className="min-w-48 flex-1">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="steve"
                maxLength={24}
              />
            </Field>
            <Field label="Role" className="w-44">
              <Select value={role} onChange={(e) => setRole(e.target.value as AccessRole)}>
                <option value="admin">Admin</option>
                <option value="moderator">Moderator</option>
                <option value="viewer">Viewer</option>
              </Select>
            </Field>
            <Button type="submit" loading={busy === "invite"} disabled={!username.trim()}>
              <UserPlus className="size-4" />
              Invite
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
