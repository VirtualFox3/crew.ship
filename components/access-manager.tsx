"use client";

import { useState } from "react";
import { Crown, Pencil, Trash2, UserPlus, X } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
} from "@/components/ui";
import { PermissionPicker } from "@/components/permission-picker";
import { api, errorMessage } from "@/lib/client-api";
import {
  ROLE_PRESETS,
  describePermissions,
  permissionsFor,
  type Capability,
} from "@/lib/permissions";
import type { AccessRole } from "@/lib/types";

interface Member {
  user_id: string;
  role: AccessRole;
  permissions: string[] | null;
  created_at: string;
  profiles: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

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
  const [granted, setGranted] = useState<Capability[]>([...ROLE_PRESETS.moderator]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Capability[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { members } = await api<{ members: Member[] }>(`/api/servers/${serverId}/access`);
    setMembers(members);
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy("invite");
    setError(null);
    try {
      await api(`/api/servers/${serverId}/access`, {
        method: "POST",
        // The role is only a label once permissions are explicit; store the
        // closest preset so the badge reads sensibly.
        json: { username: username.trim(), role: roleFor(granted), permissions: granted },
      });
      await reload();
      setUsername("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function save(member: Member) {
    setBusy(member.user_id);
    setError(null);
    try {
      await api(`/api/servers/${serverId}/access`, {
        method: "PATCH",
        json: { userId: member.user_id, role: roleFor(draft), permissions: draft },
      });
      await reload();
      setEditing(null);
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
          description="Tick exactly what each person may do. Presets are a starting point, not a limit."
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
            {members.map((member) => {
              const effective = permissionsFor(member.role, member.permissions);
              const open = editing === member.user_id;

              return (
                <li key={member.user_id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-8 shrink-0 place-items-center bg-ink-800 text-xs font-semibold text-ink-300">
                      {(member.profiles?.username ?? "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {member.profiles?.username ?? "unknown"}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {effective.length
                          ? effective.join(" · ")
                          : "No permissions — they can open the server but do nothing"}
                      </p>
                    </div>
                    <Badge tone={effective.length ? "grass" : "neutral"}>
                      {describePermissions(effective)}
                    </Badge>

                    {isOwner && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(open ? null : member.user_id);
                            setDraft(effective);
                          }}
                          title={open ? "Cancel" : "Change permissions"}
                        >
                          {open ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === member.user_id && !open}
                          onClick={() => revoke(member)}
  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          title="Remove access"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>

                  {open && (
                    <div className="mt-3 border border-ink-700 bg-ink-900/60 p-3">
                      <PermissionPicker value={draft} onChange={setDraft} />
                      <div className="mt-3 flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          loading={busy === member.user_id}
                          onClick={() => save(member)}
                        >
                          Save permissions
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
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
          <CardHeader
            title="Invite someone"
            description="They need a free Howl.Host account first. Playing needs no account — only the server address."
          />
          <form onSubmit={invite} className="space-y-4 p-5">
            <Field
              label="Howl.Host username"
              hint="Not their email or Minecraft name — the username they signed up with."
  className="max-w-sm"
            >
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="steve"
                maxLength={24}
              />
            </Field>

            <div>
              <p className="mb-2 text-xs font-medium text-ink-300">What they can do</p>
              <PermissionPicker value={granted} onChange={setGranted} />
            </div>

            <div className="flex justify-end">
              <Button type="submit" loading={busy === "invite"} disabled={!username.trim()}>
                <UserPlus className="size-4" />
                Invite
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

/** Closest matching preset, used only as a display label. */
function roleFor(granted: Capability[]): AccessRole {
  const key = [...granted].sort().join(",");
  for (const [role, preset] of Object.entries(ROLE_PRESETS)) {
    if ([...preset].sort().join(",") === key) return role as AccessRole;
  }
  // Custom sets are labelled by their most powerful capability.
  if (granted.includes("settings") || granted.includes("worlds")) return "admin";
  return granted.length > 1 ? "moderator" : "viewer";
}
