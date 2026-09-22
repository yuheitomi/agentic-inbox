// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, Select, Text, useKumoToastManager } from "@cloudflare/kumo";
import { EnvelopeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link as RouterLink, useFetcher } from "react-router";
import { errorMessage, field, ok, serverApi } from "~/services/api.server";
import type { Route } from "./+types/index";

export function meta() {
  return [{ title: "Agentic Inbox" }];
}

type ActionData = { ok: true } | { ok: false; error: string };

/**
 * Mailboxes and routing config for the home page. Both calls stay in-process
 * via the RPC client, so the list is in the first response.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const api = serverApi(context, request);
  const [mailboxes, config] = await Promise.all([ok(api.mailboxes.$get()), ok(api.config.$get())]);

  return {
    mailboxes,
    domains: config.domains,
    emailAddresses: config.emailAddresses,
  };
}

/**
 * Create, delete, and the one-shot ensure of configured addresses. A failed
 * create or delete comes back as data so the dialog can show it; `ok()` would
 * throw into the error boundary instead.
 */
export async function action({ request, context }: Route.ActionArgs): Promise<ActionData> {
  const api = serverApi(context, request);
  const form = await request.formData();
  const intent = field(form, "intent");

  switch (intent) {
    case "create": {
      const email = field(form, "email");
      const name = field(form, "name");
      const res = await api.mailboxes.$post({ json: { email, name } });
      if (!res.ok) {
        return { ok: false, error: await errorMessage(res, "Failed to create mailbox") };
      }
      return { ok: true };
    }

    case "delete": {
      const mailboxId = field(form, "mailboxId");
      const res = await api.mailboxes[":mailboxId"].$delete({ param: { mailboxId } });
      if (!res.ok) {
        return { ok: false, error: await errorMessage(res, "Failed to delete mailbox") };
      }
      return { ok: true };
    }

    case "ensure": {
      const [listed, config] = await Promise.all([ok(api.mailboxes.$get()), ok(api.config.$get())]);
      const existing = new Set(listed.map((mailbox) => mailbox.email.toLowerCase()));
      const missing = config.emailAddresses.filter((addr) => !existing.has(addr.toLowerCase()));
      const failures: string[] = [];

      await Promise.all(
        missing.map(async (addr) => {
          const name = addr.split("@")[0] || addr;
          const res = await api.mailboxes.$post({ json: { email: addr, name } });
          // A second ensure can lose the race to the first; the mailbox exists.
          if (res.ok || res.status === 409) return;
          failures.push(await errorMessage(res, "Failed to create mailbox"));
        }),
      );

      const error = failures[0];
      if (error) return { ok: false, error };
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown intent: ${intent}` };
  }
}

export default function HomeRoute({ loaderData }: Route.ComponentProps) {
  const { mailboxes, domains, emailAddresses } = loaderData;
  const toastManager = useKumoToastManager();
  const createFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const ensureFetcher = useFetcher<typeof action>();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPrefix, setNewPrefix] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [mailboxToDelete, setMailboxToDelete] = useState<{
    id: string;
    email: string;
  } | null>(null);

  // Derived rather than seeded into state: `domains` comes from the loader and
  // can change under a revalidation, which a `useState` initialiser never sees.
  const domain = domains.includes(selectedDomain) ? selectedDomain : (domains[0] ?? "");

  const handledCreate = useRef<typeof createFetcher.data>(undefined);
  const handledDelete = useRef<typeof deleteFetcher.data>(undefined);

  useEffect(() => {
    if (createFetcher.state !== "idle") return;
    const result = createFetcher.data;
    if (!result || result === handledCreate.current) return;
    handledCreate.current = result;
    if (result.ok) {
      toastManager.add({ title: "Mailbox created successfully!" });
      setIsCreateOpen(false);
      setNewPrefix("");
      setNewName("");
      setCreateError(null);
      return;
    }
    setCreateError(result.error);
  }, [createFetcher.state, createFetcher.data, toastManager]);

  useEffect(() => {
    if (deleteFetcher.state !== "idle") return;
    const result = deleteFetcher.data;
    if (!result || result === handledDelete.current) return;
    handledDelete.current = result;
    if (result.ok) {
      toastManager.add({ title: "Mailbox deleted" });
      setIsDeleteOpen(false);
      setMailboxToDelete(null);
      return;
    }
    toastManager.add({ title: result.error, variant: "error" });
  }, [deleteFetcher.state, deleteFetcher.data, toastManager]);

  // Auto-creation runs without anyone watching, so a failure has to announce
  // itself: the addresses are listed from config either way, and their
  // mailboxes would 404 on the way in.
  const handledEnsure = useRef<typeof ensureFetcher.data>(undefined);
  useEffect(() => {
    if (ensureFetcher.state !== "idle") return;
    const result = ensureFetcher.data;
    if (!result || result === handledEnsure.current) return;
    handledEnsure.current = result;
    if (!result.ok) {
      toastManager.add({ title: result.error, variant: "error" });
    }
  }, [ensureFetcher.state, ensureFetcher.data, toastManager]);

  // Configured addresses that have no mailbox yet are created once. The
  // action revalidates this loader, so the list updates without a refetch.
  const autoCreateDone = useRef(false);
  useEffect(() => {
    if (autoCreateDone.current) return;
    if (emailAddresses.length === 0) return;
    autoCreateDone.current = true;
    const existingEmails = new Set(mailboxes.map((mailbox) => mailbox.email.toLowerCase()));
    const missing = emailAddresses.some((addr) => !existingEmails.has(addr.toLowerCase()));
    if (!missing) return;

    const form = new FormData();
    form.set("intent", "ensure");
    void ensureFetcher.submit(form, { method: "post" });
    // `ensureFetcher` is stable per fetcher; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailAddresses, mailboxes]);

  const handleCreate = (event: FormEvent) => {
    if (!newPrefix || !domain) {
      event.preventDefault();
      setCreateError("Please fill in all fields");
      return;
    }
    setCreateError(null);
  };

  const isConfigured = emailAddresses.length > 0;
  const accounts = isConfigured
    ? emailAddresses.map((addr) => ({
        id: addr,
        email: addr,
        name: addr.split("@")[0] || addr,
      }))
    : mailboxes;
  const isCreating = createFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";

  return (
    <div className="min-h-screen bg-kumo-recessed">
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-kumo-default">Mailboxes</h1>
            {!isConfigured && (
              <Button
                variant="primary"
                icon={<PlusIcon size={16} />}
                onClick={() => setIsCreateOpen(true)}
              >
                New Mailbox
              </Button>
            )}
          </div>
          {domains.length > 0 && (
            <p className="text-sm text-kumo-subtle mt-1">{domains.join(", ")}</p>
          )}
        </div>

        {accounts.length > 0 ? (
          <div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
            {accounts.map((account, idx) => (
              <RouterLink
                key={account.id}
                to={`/mailbox/${account.id}`}
                className={`group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-kumo-tint ${
                  idx > 0 ? "border-t border-kumo-line" : ""
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">
                  {account.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-kumo-default truncate">
                    {account.name}
                  </div>
                  <div className="text-sm text-kumo-subtle">{account.email}</div>
                </div>
                {!isConfigured && (
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="square"
                    icon={<TrashIcon size={16} />}
                    aria-label={`Delete mailbox ${account.email}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMailboxToDelete({
                        id: account.id,
                        email: account.email,
                      });
                      setIsDeleteOpen(true);
                    }}
                  />
                )}
              </RouterLink>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4">
                <EnvelopeIcon size={48} weight="thin" className="text-kumo-subtle" />
              </div>
              <h3 className="text-base font-semibold text-kumo-default mb-1.5">No mailboxes yet</h3>
              <p className="text-sm text-kumo-subtle max-w-sm mb-5">
                {isConfigured
                  ? "Your email routing is configured but no mailboxes have been created yet. They will appear here automatically."
                  : "Create a mailbox to start sending and receiving emails with your domain."}
              </p>
              {!isConfigured && (
                <Button
                  variant="primary"
                  icon={<PlusIcon size={16} />}
                  onClick={() => setIsCreateOpen(true)}
                >
                  Create Mailbox
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog.Root
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (open) setCreateError(null);
        }}
      >
        <Dialog size="sm" className="p-6">
          <Dialog.Title className="text-base font-semibold mb-5">Create New Mailbox</Dialog.Title>
          <createFetcher.Form method="post" onSubmit={handleCreate} className="space-y-4">
            <input type="hidden" name="intent" value="create" />
            <input
              type="hidden"
              name="email"
              value={newPrefix && domain ? `${newPrefix}@${domain}` : ""}
            />
            <input type="hidden" name="name" value={newName || newPrefix} />
            {createError && (
              <Text variant="error" size="sm">
                {createError}
              </Text>
            )}
            <div>
              <span className="text-sm font-medium text-kumo-default mb-1.5 block">
                Email Address
              </span>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    aria-label="Address prefix"
                    placeholder="info"
                    size="sm"
                    value={newPrefix}
                    onChange={(e) => setNewPrefix(e.target.value)}
                    required
                  />
                </div>
                <span className="text-sm text-kumo-subtle">@</span>
                {domains.length > 1 ? (
                  <div className="flex-1">
                    <Select
                      aria-label="Domain"
                      value={domain}
                      onValueChange={(value) => {
                        if (value) setSelectedDomain(value);
                      }}
                    >
                      {domains.map((d) => (
                        <Select.Option key={d} value={d}>
                          {d}
                        </Select.Option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <span className="text-sm text-kumo-subtle">{domain || "no domain"}</span>
                )}
              </div>
            </div>
            <Input
              label="Display Name (optional)"
              placeholder="Info"
              size="sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close
                render={(props) => (
                  <Button {...props} type="button" variant="secondary" size="sm">
                    Cancel
                  </Button>
                )}
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={isCreating}
                disabled={!domain}
              >
                Create
              </Button>
            </div>
          </createFetcher.Form>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root
        open={isDeleteOpen}
        onOpenChange={(open) => {
          setIsDeleteOpen(open);
          if (!open) setMailboxToDelete(null);
        }}
      >
        <Dialog size="sm" className="p-6">
          <Dialog.Title className="text-base font-semibold mb-2">Delete Mailbox</Dialog.Title>
          <Dialog.Description className="text-kumo-subtle text-sm mb-5">
            Are you sure you want to delete{" "}
            <strong className="text-kumo-default">{mailboxToDelete?.email}</strong>? This action
            cannot be undone.
          </Dialog.Description>
          <deleteFetcher.Form method="post" className="flex justify-end gap-2">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="mailboxId" value={mailboxToDelete?.id ?? ""} />
            <Dialog.Close
              render={(props) => (
                <Button {...props} type="button" variant="secondary" size="sm">
                  Cancel
                </Button>
              )}
            />
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              loading={isDeleting}
              disabled={!mailboxToDelete}
            >
              Delete
            </Button>
          </deleteFetcher.Form>
        </Dialog>
      </Dialog.Root>
    </div>
  );
}
