// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Input, LinkButton, Tooltip } from "@cloudflare/kumo";
import {
  ArchiveIcon,
  CaretLeftIcon,
  FileIcon,
  FolderIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { href, Link, NavLink, useFetcher, useLocation } from "react-router";
import { Folders, SYSTEM_FOLDER_IDS } from "shared/folders";
import { useMailboxData } from "~/hooks/useMailboxData";
import { useUIStore } from "~/hooks/useUIStore";
import { composeHref } from "~/lib/compose";

/** Fetcher key for folder mutations; the mailbox layout reports their outcome. */
export const FOLDER_FETCHER_KEY = "folders";

const FOLDER_ICONS: Record<string, React.ReactNode> = {
  [Folders.INBOX]: <TrayIcon size={18} weight="regular" />,
  [Folders.SENT]: <PaperPlaneTiltIcon size={18} weight="regular" />,
  [Folders.DRAFT]: <FileIcon size={18} weight="regular" />,
  [Folders.ARCHIVE]: <ArchiveIcon size={18} weight="regular" />,
  [Folders.TRASH]: <TrashIcon size={18} weight="regular" />,
};

const SYSTEM_FOLDER_LINKS = [
  { id: Folders.INBOX, label: "Inbox" },
  { id: Folders.SENT, label: "Sent" },
  { id: Folders.DRAFT, label: "Drafts" },
  { id: Folders.ARCHIVE, label: "Archive" },
  { id: Folders.TRASH, label: "Trash" },
];

interface FolderLinkProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  unreadCount?: number;
  onClick?: () => void;
}

function FolderLink({ to, icon, label, unreadCount, onClick }: FolderLinkProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 py-2 px-3 rounded-md text-sm transition-colors ${
          isActive
            ? "bg-kumo-fill font-semibold text-kumo-default"
            : "text-kumo-strong hover:bg-kumo-tint"
        }`
      }
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {unreadCount != null && unreadCount > 0 && <Badge variant="secondary">{unreadCount}</Badge>}
    </NavLink>
  );
}

export default function Sidebar() {
  const location = useLocation();
  // Folders and the mailbox record come from the `mailbox` route's loader --
  // the layer that owns the chrome this sidebar is part of.
  const { folders, mailbox: currentMailbox } = useMailboxData();
  const mailboxId = currentMailbox.id;
  const folderFetcher = useFetcher({ key: FOLDER_FETCHER_KEY });
  const { closeSidebar } = useUIStore();
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const customFolders = useMemo(
    () => folders.filter((f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id)),
    [folders],
  );

  const getUnreadCount = (folderId: string) => {
    const found = folders.find((f) => f.id === folderId);
    return found?.unreadCount || 0;
  };

  const newMessageHref = composeHref(location, mailboxId, { mode: "new" });

  const displayName = useMemo(() => {
    // Prefer settings.fromName > name > local part of email
    if (currentMailbox.settings?.fromName) {
      return currentMailbox.settings.fromName;
    }
    if (currentMailbox.name && currentMailbox.name !== currentMailbox.email) {
      return currentMailbox.name;
    }
    return currentMailbox.email.split("@")[0] || currentMailbox.name;
  }, [currentMailbox]);

  const handleNavClick = () => {
    // Close mobile sidebar on navigation
    closeSidebar();
  };

  return (
    <aside className="h-full w-64 bg-kumo-recessed flex flex-col shrink-0 border-r border-kumo-line">
      {/* Back + identity */}
      <div className="px-4 pt-4 pb-1">
        <Link
          to="/"
          onClick={closeSidebar}
          className="flex w-fit items-center gap-1.5 text-kumo-subtle text-sm no-underline hover:text-kumo-default transition-colors mb-2.5"
        >
          <CaretLeftIcon size={14} />
          <span>Mailboxes</span>
        </Link>
        <div className="px-1">
          <div className="text-base font-semibold text-kumo-default truncate">{displayName}</div>
          <div className="text-sm text-kumo-subtle truncate mt-0.5">{currentMailbox.email}</div>
        </div>
      </div>

      {/* Compose */}
      <div className="px-3 py-3">
        <LinkButton
          href={newMessageHref}
          onClick={closeSidebar}
          variant="primary"
          icon={<PencilSimpleIcon size={16} />}
          className="w-full"
        >
          Compose
        </LinkButton>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {SYSTEM_FOLDER_LINKS.map((folder) => (
          <FolderLink
            key={folder.id}
            to={href("/mailbox/:mailboxId/emails/:folder", { mailboxId, folder: folder.id })}
            icon={FOLDER_ICONS[folder.id]}
            label={folder.label}
            unreadCount={getUnreadCount(folder.id)}
            onClick={handleNavClick}
          />
        ))}

        {/* Custom folders */}
        {customFolders.length > 0 && (
          <div className="pt-5">
            <div className="flex items-center justify-between px-3 mb-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
                Folders
              </span>
              <Tooltip content="New folder" asChild>
                <Button
                  variant="ghost"
                  shape="square"
                  size="sm"
                  icon={<PlusIcon size={16} />}
                  onClick={() => setIsCreateFolderOpen(true)}
                  aria-label="Create new folder"
                />
              </Tooltip>
            </div>
            {customFolders.map((folder) => (
              <FolderLink
                key={folder.id}
                to={href("/mailbox/:mailboxId/emails/:folder", { mailboxId, folder: folder.id })}
                icon={<FolderIcon size={18} />}
                label={folder.name}
                unreadCount={folder.unreadCount}
                onClick={handleNavClick}
              />
            ))}
          </div>
        )}

        {/* Add folder button when no custom folders */}
        {customFolders.length === 0 && (
          <div className="pt-5">
            <div className="flex items-center justify-between px-3 mb-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
                Folders
              </span>
              <Tooltip content="New folder" asChild>
                <Button
                  variant="ghost"
                  shape="square"
                  size="sm"
                  icon={<PlusIcon size={16} />}
                  onClick={() => setIsCreateFolderOpen(true)}
                  aria-label="Create new folder"
                />
              </Tooltip>
            </div>
          </div>
        )}
      </nav>

      {/* Create folder dialog */}
      <Dialog.Root open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <Dialog size="sm" className="p-6">
          <Dialog.Title className="text-base font-semibold mb-4">Create folder</Dialog.Title>
          <folderFetcher.Form
            method="post"
            action={href("/mailbox/:mailboxId/folders", { mailboxId })}
            onSubmit={() => {
              // The layout toasts the outcome; the dialog need not wait for it.
              setNewFolderName("");
              setIsCreateFolderOpen(false);
            }}
            className="space-y-4"
          >
            <input type="hidden" name="intent" value="createFolder" />
            <Input
              label="Folder name"
              name="name"
              placeholder="e.g. Projects"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              required
            />
            <div className="flex justify-end gap-2">
              <Dialog.Close
                render={(props) => (
                  <Button {...props} type="button" variant="secondary">
                    Cancel
                  </Button>
                )}
              />
              <Button type="submit" variant="primary" disabled={!newFolderName.trim()}>
                Create
              </Button>
            </div>
          </folderFetcher.Form>
        </Dialog>
      </Dialog.Root>
    </aside>
  );
}
