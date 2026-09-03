"use client"

import { useEffect, useState } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PackageCheckIcon,
} from "lucide-react"

import { Button } from "../ui/button"
import { ButtonGroup } from "../ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"

export type UpdateStatus =
  | "available"
  | "downloading"
  | "ready-to-install"
  | "error"

type DisplayUpdateStatus = UpdateStatus | "downloaded" | "verifying"

interface ButtonGroupDropdownProps {
  status: UpdateStatus
  progress?: number
  onUpdate: () => Promise<void> | void
  onInstall: () => Promise<void> | void
  onViewChangelog: () => void
}

export function ButtonGroupDropdown({
  status,
  progress,
  onUpdate,
  onInstall,
  onViewChangelog,
}: ButtonGroupDropdownProps) {
  const [displayStatus, setDisplayStatus] = useState<DisplayUpdateStatus>(status)

  useEffect(() => {
    if (status !== "ready-to-install") {
      setDisplayStatus(status)
      return
    }
    setDisplayStatus("downloaded")
    const verifyTimer = window.setTimeout(() => setDisplayStatus("verifying"), 700)
    const readyTimer = window.setTimeout(() => setDisplayStatus("ready-to-install"), 2500)
    return () => {
      window.clearTimeout(verifyTimer)
      window.clearTimeout(readyTimer)
    }
  }, [status])

  const isDownloading = displayStatus === "downloading"
  const isDownloaded = displayStatus === "downloaded"
  const isVerifying = displayStatus === "verifying"
  const isReadyToInstall = displayStatus === "ready-to-install"
  const downloadLabel = typeof progress === "number" ? `Downloading ${Math.round(progress)}%` : "Downloading…"

  const handleUpdate = async () => {
    if (displayStatus !== "available" && displayStatus !== "error") return
    await onUpdate()
  }

  const handleInstall = async () => {
    if (!isReadyToInstall) return
    await onInstall()
  }

  const handlePrimaryAction = () => {
    if (displayStatus === "available" || displayStatus === "error") {
      void handleUpdate()
      return
    }

    if (isReadyToInstall) {
      void handleInstall()
    }
  }

  const primaryDisabled = isDownloading || isDownloaded || isVerifying

  return (
    <ButtonGroup
      className="
        overflow-hidden
        rounded-lg
        bg-linear-to-b
        from-blue-500
        to-blue-700
        text-white
        shadow-sm
        ring-1
        ring-inset
        ring-white/20
      "
    >
      {/* Primary update state / action */}
      <Button
        type="button"
        size="xs"
        onClick={handlePrimaryAction}
        disabled={primaryDisabled}
        aria-live="polite"
        className="
          rounded-none
          border-0
          bg-transparent
          text-white
          shadow-none
          hover:bg-white/10
          hover:text-white
          disabled:pointer-events-none
          disabled:opacity-100
          focus-visible:ring-0
          active:bg-white/15
        "
      >
        {displayStatus === "available" && (
          <>
            <DownloadIcon className="size-3.5" />
            Download update
          </>
        )}

        {isDownloading && (
          <>
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            {downloadLabel}
          </>
        )}

        {isDownloaded && (
          <>
            <CheckIcon className="size-3.5" />
            Downloaded
          </>
        )}

        {isVerifying && (
          <>
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Verifying package…
          </>
        )}

        {displayStatus === "error" && (
          <>
            <DownloadIcon className="size-3.5" />
            Retry update
          </>
        )}

        {isReadyToInstall && (
          <>
            <PackageCheckIcon className="size-3.5" />
            Click to install
          </>
        )}
      </Button>

      {/* Secondary actions */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="xs"
              aria-label="Update actions"
              title="Update actions"
              className="
                rounded-none
                border-0
                bg-transparent
                px-1.5!
                text-white
                shadow-none
                hover:bg-white/10
                hover:text-white
                focus-visible:ring-0
                active:bg-white/15
              "
            >
              <ChevronDownIcon className="size-3.5" />
            </Button>
          }
        />

        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onViewChangelog}>
              <FileTextIcon />
              View changelog
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {(displayStatus === "available" || displayStatus === "error") && (
              <DropdownMenuItem
                onClick={() => {
                  void handleUpdate()
                }}
              >
                <DownloadIcon />
                {displayStatus === "error" ? "Retry update" : "Download update"}
              </DropdownMenuItem>
            )}

            {isDownloading && (
              <DropdownMenuItem disabled>
                <LoaderCircleIcon className="animate-spin" />
                {downloadLabel}
              </DropdownMenuItem>
            )}

            {isDownloaded && (
              <DropdownMenuItem disabled>
                <CheckIcon />
                Downloaded
              </DropdownMenuItem>
            )}

            {isVerifying && (
              <DropdownMenuItem disabled>
                <LoaderCircleIcon className="animate-spin" />
                Verifying package…
              </DropdownMenuItem>
            )}

            {isReadyToInstall && (
              <DropdownMenuItem
                onClick={() => {
                  void handleInstall()
                }}
              >
                <PackageCheckIcon />
                Install update
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
