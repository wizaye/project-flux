"use client"

import type { ReactNode } from "react"

import { ButtonGroup } from "../ui/button-group"

export function GroupButton({ children }: { children: ReactNode }) {
  return <ButtonGroup>{children}</ButtonGroup>
}
