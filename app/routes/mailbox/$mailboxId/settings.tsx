// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon, RobotIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useFetcher } from "react-router";
import { useMailboxData } from "~/hooks/useMailboxData";
import { useSubmissionToast } from "~/hooks/useSubmissionToast";
import { type ActionResult, field, ok, result, serverApi } from "~/services/api.server";
import type { Mailbox } from "~/types";
import type { Route } from "./+types/settings";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

export function meta() {
  return [{ title: "Settings — Agentic Inbox" }];
}

/**
 * Saves the fields this page edits. The API replaces settings wholesale, so
 * they are merged into the stored record here -- the form only carries its own
 * two fields and cannot drop the rest (signature, forwarding, auto-reply).
 */
export async function action({
  params,
  request,
  context,
}: Route.ActionArgs): Promise<ActionResult> {
  const api = serverApi(context, request);
  const form = await request.formData();
  const param = { mailboxId: params.mailboxId };

  const mailbox = await ok(api.mailboxes[":mailboxId"].$get({ param }));
  const settings = {
    ...mailbox.settings,
    fromName: field(form, "fromName"),
    agentSystemPrompt: field(form, "agentSystemPrompt").trim() || undefined,
  };
  return result(
    api.mailboxes[":mailboxId"].$put({ param, json: { settings } }),
    "Failed to save settings",
  );
}

export default function SettingsRoute() {
  // The mailbox record is already loaded by the layout; no loader of our own.
  const { mailbox } = useMailboxData();
  // Keyed on the mailbox so switching mailboxes starts the form over.
  return <SettingsForm key={mailbox.id} mailbox={mailbox} />;
}

function SettingsForm({ mailbox }: { mailbox: Mailbox }) {
  const fetcher = useFetcher<typeof action>();
  useSubmissionToast(fetcher, { save: "Settings saved!" });

  // Controlled only because the prompt's "Custom"/"Default" badge and reset
  // button follow the textarea as the user types.
  const [agentPrompt, setAgentPrompt] = useState(mailbox.settings?.agentSystemPrompt || "");
  // Pinned at mount: a save revalidates `mailbox`, and an uncontrolled
  // input's default must not change under it.
  const [initialName] = useState(mailbox.settings?.fromName || mailbox.name || "");
  const isSaving = fetcher.state !== "idle";

  const isCustomPrompt = agentPrompt.trim().length > 0;

  return (
    <fetcher.Form
      method="post"
      className="block max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto"
    >
      <h1 className="text-lg font-semibold text-kumo-default mb-6">Settings</h1>

      <div className="space-y-6">
        {/* Account */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="text-sm font-medium text-kumo-default mb-4">Account</div>
          <div className="space-y-3">
            <Input label="Display Name" name="fromName" defaultValue={initialName} />
            <Input label="Email" type="email" value={mailbox.email} disabled />
          </div>
        </div>

        {/* Agent System Prompt */}
        <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
              <span className="text-sm font-medium text-kumo-default">AI Agent Prompt</span>
              {isCustomPrompt ? (
                <Badge variant="primary">Custom</Badge>
              ) : (
                <Badge variant="secondary">Default</Badge>
              )}
            </div>
            {isCustomPrompt && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                icon={<ArrowCounterClockwiseIcon size={14} />}
                onClick={() => setAgentPrompt("")}
              >
                Reset to default
              </Button>
            )}
          </div>
          <p className="text-xs text-kumo-subtle mb-3">
            Customize how the AI agent behaves for this mailbox. Leave empty to use the built-in
            default prompt.
          </p>
          <textarea
            name="agentSystemPrompt"
            aria-label="AI agent prompt"
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            placeholder={PROMPT_PLACEHOLDER}
            rows={12}
            className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
          />
          <p className="text-xs text-kumo-subtle mt-2">
            The prompt is sent as the system message to the AI model. It controls the agent's
            personality, writing style, and behavior rules.
          </p>
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <Button type="submit" name="intent" value="save" variant="primary" loading={isSaving}>
            Save Changes
          </Button>
        </div>
      </div>
    </fetcher.Form>
  );
}
