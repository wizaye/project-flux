"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react"
import {
  Accessibility,
  ArrowLeft,
  BookOpen,
  Bot,
  Brain,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Cloud,
  Code2,
  Cpu,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe2,
  GraduationCap,
  Loader2,
  PencilLine,
  Search,
  Terminal,
  UserRound,
  X,
} from "lucide-react"
import { motion } from "motion/react"

import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../ui/field"

// Adjust these paths to wherever the Motion Primitives CLI installs them.
import { TextEffect } from "../ui/text-effect"
import { AnimatedGroup } from "../ui/animated-group"
import { TransitionPanel } from "../ui/transition-panel"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

const STEPS = [
  "welcome",
  "permissions",
  "profile",
  "recommendations",
  "ai",
  "git",
  "publish",
  "workspace",
  "done",
] as const

type Step = (typeof STEPS)[number]

type PermissionStatus =
  | "unknown"
  | "checking"
  | "granted"
  | "denied"
  | "not-applicable"

type Experience = "simple" | "balanced" | "power"

type AIMode = "ask" | "edit" | "agent"

type UseCase =
  | "study"
  | "research"
  | "development"
  | "writing"
  | "knowledge"
  | "work"
  | "journaling"

type WorkspaceMode = "new" | "existing" | null

interface OnboardingState {
  version: 1
  completed: boolean
  skipped: boolean
  step: Step

  permissions: {
    accessibility: PermissionStatus
    requiresRelaunch: boolean
  }

  profile: {
    useCases: UseCase[]
    experience: Experience
  }

  recommendationsAccepted: boolean

  ai: {
    enabled: boolean | null
    providers: string[]
    mode: AIMode
  }

  git: {
    enabled: boolean
    status: "idle" | "checking" | "installed" | "missing"
    version?: string
  }

  publish: {
    enabled: boolean
  }

  workspace: {
    mode: WorkspaceMode
    name: string
    parentPath: string
    path: string
    creating: boolean
    error?: string
  }
}

// -----------------------------------------------------------------------------
// Native API contract
// -----------------------------------------------------------------------------

export interface FluxNativeAPI {
  permissions: {
    getAccessibilityStatus(): Promise<{
      granted: boolean
      requiresRelaunch?: boolean
      supported: boolean
    }>

    requestAccessibility(): Promise<{
      granted: boolean
      requiresRelaunch?: boolean
      supported: boolean
    }>
  }

  system: {
    relaunch(): Promise<void>
  }

  git: {
    detect(): Promise<{
      installed: boolean
      version?: string
    }>

    openInstallGuide(): Promise<void>
  }

  workspace: {
    pickDirectory(): Promise<string | null>

    create(input: {
      parentPath: string
      name: string
      initGit: boolean
    }): Promise<{
      path: string
    }>

    open(input: {
      path: string
      initGit: boolean
    }): Promise<{
      path: string
    }>
  }

  onboarding: {
    load(): Promise<OnboardingState | null>
    save(state: OnboardingState): Promise<void>
    finish(input: { skipped: boolean }): Promise<void>
  }
}

declare global {
  interface Window {
    flux?: FluxNativeAPI
  }
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

const DEFAULT_STATE: OnboardingState = {
  version: 1,
  completed: false,
  skipped: false,
  step: "welcome",

  permissions: {
    accessibility: "unknown",
    requiresRelaunch: false,
  },

  profile: {
    useCases: [],
    experience: "balanced",
  },

  recommendationsAccepted: false,

  ai: {
    enabled: null,
    providers: [],
    mode: "ask",
  },

  git: {
    enabled: true,
    status: "idle",
  },

  publish: {
    enabled: false,
  },

  workspace: {
    mode: null,
    name: "",
    parentPath: "",
    path: "",
    creating: false,
  },
}

const STORAGE_KEY = "flux:onboarding:v1"

// -----------------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------------

const USE_CASES: Array<{
  id: UseCase
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
}> = [
  {
    id: "study",
    title: "Study & learning",
    description: "Notes, courses, revision and learning material.",
    icon: GraduationCap,
  },
  {
    id: "research",
    title: "Research",
    description: "Sources, PDFs, references and connected ideas.",
    icon: Search,
  },
  {
    id: "development",
    title: "Software development",
    description: "Technical notes, projects, code and documentation.",
    icon: Code2,
  },
  {
    id: "writing",
    title: "Writing",
    description: "Articles, drafts, documentation and long-form work.",
    icon: PencilLine,
  },
  {
    id: "knowledge",
    title: "Personal knowledge",
    description: "Build a connected long-term knowledge base.",
    icon: Brain,
  },
  {
    id: "work",
    title: "Work & projects",
    description: "Meetings, decisions, tasks and project context.",
    icon: BriefcaseBusiness,
  },
  {
    id: "journaling",
    title: "Journaling",
    description: "Daily notes, logs and personal reflection.",
    icon: BookOpen,
  },
]

const AI_PROVIDERS = {
  Cloud: [
    { id: "claude", name: "Claude" },
    { id: "openai", name: "OpenAI / Codex" },
    { id: "gemini", name: "Gemini" },
    { id: "grok", name: "Grok" },
  ],

  Local: [
    { id: "ollama", name: "Ollama" },
    { id: "lm-studio", name: "LM Studio" },
  ],

  "Agent / CLI": [
    { id: "claude-code", name: "Claude Code" },
    { id: "codex-cli", name: "Codex CLI" },
    { id: "opencode", name: "OpenCode" },
    { id: "antigravity", name: "Antigravity" },
  ],
}

// -----------------------------------------------------------------------------
// Root
// -----------------------------------------------------------------------------

export function OnboardingDemo({
  onComplete,
}: {
  onComplete?: () => void
}) {
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE)
  const [hydrated, setHydrated] = useState(false)
  const [direction, setDirection] = useState(1)

  const stepIndex = STEPS.indexOf(state.step)

  const persist = useCallback(async (next: OnboardingState) => {
    setState(next)

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))

    try {
      await window.flux?.onboarding.save(next)
    } catch (error) {
      console.warn("Failed to persist onboarding state natively", error)
    }
  }, [])

  const patch = useCallback(
    (
      updater:
        | Partial<OnboardingState>
        | ((current: OnboardingState) => OnboardingState)
    ) => {
      setState((current) => {
        const next =
          typeof updater === "function"
            ? updater(current)
            : { ...current, ...updater }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))

        void window.flux?.onboarding.save(next).catch(console.warn)

        return next
      })
    },
    []
  )

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      try {
        const nativeState = await window.flux?.onboarding.load()

        if (nativeState && !cancelled) {
          setState(nativeState)
          setHydrated(true)
          return
        }
      } catch {
        // Fall back to renderer persistence.
      }

      try {
        const stored = localStorage.getItem(STORAGE_KEY)

        if (stored && !cancelled) {
          setState(JSON.parse(stored))
        }
      } catch {
        // Ignore invalid old onboarding data.
      }

      if (!cancelled) {
        setHydrated(true)
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [])

  const goTo = useCallback(
    (step: Step, newDirection = 1) => {
      setDirection(newDirection)

      patch((current) => ({
        ...current,
        step,
      }))
    },
    [patch]
  )

  const next = useCallback(() => {
    const index = STEPS.indexOf(state.step)

    if (index < STEPS.length - 1) {
      goTo(STEPS[index + 1], 1)
    }
  }, [goTo, state.step])

  const back = useCallback(() => {
    const index = STEPS.indexOf(state.step)

    if (index > 0) {
      goTo(STEPS[index - 1], -1)
    }
  }, [goTo, state.step])

  const finish = useCallback(
    async (skipped: boolean) => {
      const nextState: OnboardingState = {
        ...state,
        completed: true,
        skipped,
      }

      await persist(nextState)

      try {
        await window.flux?.onboarding.finish({ skipped })
      } finally {
        onComplete?.()
      }
    },
    [onComplete, persist, state]
  )

  const recommendations = useMemo(
    () => buildRecommendations(state),
    [state.profile]
  )

  if (!hydrated) {
    return (
      <main className="flex h-svh min-h-0 items-center justify-center overflow-y-auto bg-[var(--window-well)]">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </main>
    )
  }

  const screens = [
    <WelcomeStep
      key="welcome"
      onStart={next}
      onSkip={() => finish(true)}
    />,

    <PermissionsStep
      key="permissions"
      state={state}
      patch={patch}
      onBack={back}
      onContinue={next}
    />,

    <ProfileStep
      key="profile"
      state={state}
      patch={patch}
      onBack={back}
      onContinue={next}
    />,

    <RecommendationsStep
      key="recommendations"
      recommendations={recommendations}
      state={state}
      patch={patch}
      onBack={back}
      onContinue={next}
    />,

    <AIStep
      key="ai"
      state={state}
      patch={patch}
      onBack={back}
      onContinue={next}
    />,

    <GitStep
      key="git"
      state={state}
      patch={patch}
      onBack={back}
      onContinue={next}
    />,

    <PublishStep
      key="publish"
      state={state}
      patch={patch}
      onBack={back}
      onContinue={next}
      onSetupGit={() => goTo("git", -1)}
    />,

    <WorkspaceStep
      key="workspace"
      state={state}
      patch={patch}
      onBack={back}
      onComplete={() => goTo("done", 1)}
    />,

    <DoneStep
      key="done"
      state={state}
      onOpen={() => finish(false)}
    />,
  ]

  return (
    <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-[var(--window-well)]">
      {state.step !== "welcome" && state.step !== "done" && (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto flex w-full max-w-lg items-center justify-between">
            <FluxMark compact />

            <span className="text-xs text-muted-foreground">
              {stepIndex} of {STEPS.length - 2}
            </span>
          </div>

          <div className="mx-auto mt-5 h-px w-full max-w-lg overflow-hidden bg-border">
            <motion.div
              className="h-full bg-foreground"
              animate={{
                width: `${(stepIndex / (STEPS.length - 2)) * 100}%`,
              }}
              transition={{
                duration: 0.25,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-y-auto p-6 md:p-10">
        <div className="m-auto w-full max-w-lg">
          <TransitionPanel
            activeIndex={stepIndex}
            custom={direction}
            variants={{
              enter: (custom: number) => ({
                opacity: 0,
                x: custom > 0 ? 14 : -14,
              }),
              center: {
                opacity: 1,
                x: 0,
              },
              exit: (custom: number) => ({
                opacity: 0,
                x: custom > 0 ? -14 : 14,
              }),
            }}
            transition={{
              duration: 0.2,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {screens}
          </TransitionPanel>
        </div>
      </div>
    </main>
  )
}

// -----------------------------------------------------------------------------
// Welcome
// -----------------------------------------------------------------------------

function WelcomeStep({
  onStart,
  onSkip,
}: {
  onStart: () => void
  onSkip: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <FluxMark />

      <div className="space-y-3">
        <TextEffect
          as="h1"
          per="word"
          preset="fade"
          className="text-2xl font-semibold tracking-tight"
          speedReveal={1.5}
        >
          Welcome to Flux
        </TextEffect>

        <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
          Your second brain, on your terms. Keep your notes, files, ideas,
          research and projects connected without giving up ownership of your
          data.
        </p>
      </div>

      <AnimatedGroup
        preset="fade"
        className="flex w-full max-w-sm flex-col gap-3"
        variants={{
          container: {
            hidden: {},
            visible: {
              transition: {
                staggerChildren: 0.07,
                delayChildren: 0.15,
              },
            },
          },
          item: {
            hidden: {
              opacity: 0,
              y: 6,
            },
            visible: {
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.25,
              },
            },
          },
        }}
      >
        <Button className="w-full" onClick={onStart}>
          Get started
          <ChevronRight className="size-4" />
        </Button>

        <Button variant="ghost" className="w-full" onClick={onSkip}>
          Set up later
        </Button>

        <p className="text-xs text-muted-foreground">
          You can change everything later from Settings.
        </p>
      </AnimatedGroup>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

function PermissionsStep({
  state,
  patch,
  onBack,
  onContinue,
}: StepProps) {
  const [requesting, setRequesting] = useState(false)

  const refreshAccessibility = useCallback(async () => {
    if (!window.flux) return

    patch((current) => ({
      ...current,
      permissions: {
        ...current.permissions,
        accessibility: "checking",
      },
    }))

    try {
      const result =
        await window.flux.permissions.getAccessibilityStatus()

      patch((current) => ({
        ...current,
        permissions: {
          accessibility: !result.supported
            ? "not-applicable"
            : result.granted
              ? "granted"
              : "denied",

          requiresRelaunch: Boolean(result.requiresRelaunch),
        },
      }))
    } catch {
      patch((current) => ({
        ...current,
        permissions: {
          ...current.permissions,
          accessibility: "unknown",
        },
      }))
    }
  }, [patch])

  useEffect(() => {
    void refreshAccessibility()

    const onFocus = () => {
      void refreshAccessibility()
    }

    window.addEventListener("focus", onFocus)

    return () => window.removeEventListener("focus", onFocus)
  }, [refreshAccessibility])

  async function requestAccessibility() {
    if (!window.flux) {
      // Allows the renderer UI to be tested in a normal browser.
      patch((current) => ({
        ...current,
        permissions: {
          accessibility: "granted",
          requiresRelaunch: false,
        },
      }))

      return
    }

    setRequesting(true)

    try {
      const result =
        await window.flux.permissions.requestAccessibility()

      patch((current) => ({
        ...current,
        permissions: {
          accessibility: !result.supported
            ? "not-applicable"
            : result.granted
              ? "granted"
              : "denied",

          requiresRelaunch: Boolean(result.requiresRelaunch),
        },
      }))
    } finally {
      setRequesting(false)
    }
  }

  async function relaunch() {
    await window.flux?.system.relaunch()
  }

  const accessibilityGranted =
    state.permissions.accessibility === "granted"

  return (
    <StepLayout
      title="A few permissions"
      description="Flux can integrate more deeply with your system. Enable only what you want to use."
      onBack={onBack}
      footer={
        <>
          <Button variant="ghost" onClick={onContinue}>
            Skip for now
          </Button>

          <Button onClick={onContinue}>
            Continue
            <ChevronRight className="size-4" />
          </Button>
        </>
      }
    >
      <FieldGroup>
        <PermissionRow
          icon={Folder}
          title="Workspace files"
          description="Flux reads and writes only inside workspaces you explicitly choose."
          status="later"
        />

        <PermissionRow
          icon={Accessibility}
          title="System accessibility"
          description="Required only for features that interact with selections or content in other apps."
          status={
            state.permissions.accessibility === "checking"
              ? "checking"
              : accessibilityGranted
                ? "granted"
                : state.permissions.accessibility === "not-applicable"
                  ? "not-applicable"
                  : "optional"
          }
          action={
            !accessibilityGranted &&
            state.permissions.accessibility !== "not-applicable" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={requestAccessibility}
                disabled={requesting}
              >
                {requesting && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}

                Enable
              </Button>
            ) : undefined
          }
        />

        {state.permissions.requiresRelaunch && (
          <div className="rounded-lg border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Restart required</p>

              <p className="text-sm leading-5 text-muted-foreground">
                macOS has granted the permission, but Flux needs to restart
                before the integration can be validated.
              </p>
            </div>

            <Button className="mt-4 w-full" onClick={relaunch}>
              Restart Flux
            </Button>
          </div>
        )}
      </FieldGroup>
    </StepLayout>
  )
}

// -----------------------------------------------------------------------------
// Profile
// -----------------------------------------------------------------------------

function ProfileStep({
  state,
  patch,
  onBack,
  onContinue,
}: StepProps) {
  function toggleUseCase(id: UseCase) {
    patch((current) => {
      const selected = current.profile.useCases.includes(id)

      return {
        ...current,
        profile: {
          ...current.profile,
          useCases: selected
            ? current.profile.useCases.filter((item) => item !== id)
            : [...current.profile.useCases, id],
        },
      }
    })
  }

  return (
    <StepLayout
      title="What will you use Flux for?"
      description="Choose everything that applies. We'll use this only to recommend a sensible default setup."
      onBack={onBack}
      footer={
        <Button
          onClick={onContinue}
          disabled={state.profile.useCases.length === 0}
        >
          Continue
          <ChevronRight className="size-4" />
        </Button>
      }
    >
      <AnimatedGroup
        preset="fade"
        className="space-y-2"
        variants={{
          container: {
            hidden: {},
            visible: {
              transition: {
                staggerChildren: 0.035,
              },
            },
          },
          item: {
            hidden: {
              opacity: 0,
              y: 4,
            },
            visible: {
              opacity: 1,
              y: 0,
            },
          },
        }}
      >
        {USE_CASES.map((item) => (
          <ChoiceRow
            key={item.id}
            icon={item.icon}
            title={item.title}
            description={item.description}
            selected={state.profile.useCases.includes(item.id)}
            onClick={() => toggleUseCase(item.id)}
          />
        ))}
      </AnimatedGroup>

      <div className="mt-8 space-y-3">
        <div>
          <p className="text-sm font-medium">How should Flux feel?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This controls how aggressively advanced features are surfaced.
          </p>
        </div>

        <ChoiceRow
          icon={UserRound}
          title="Simple"
          description="Keep advanced tooling out of the way."
          selected={state.profile.experience === "simple"}
          onClick={() =>
            setExperience(patch, "simple")
          }
        />

        <ChoiceRow
          icon={Brain}
          title="Balanced"
          description="Useful power features without extra complexity."
          selected={state.profile.experience === "balanced"}
          onClick={() =>
            setExperience(patch, "balanced")
          }
          recommended
        />

        <ChoiceRow
          icon={Terminal}
          title="Power user"
          description="Surface Git, automation and advanced tooling."
          selected={state.profile.experience === "power"}
          onClick={() =>
            setExperience(patch, "power")
          }
        />
      </div>
    </StepLayout>
  )
}

// -----------------------------------------------------------------------------
// Recommendations
// -----------------------------------------------------------------------------

function RecommendationsStep({
  recommendations,
  state,
  patch,
  onBack,
  onContinue,
}: StepProps & {
  recommendations: ReturnType<typeof buildRecommendations>
}) {
  function accept() {
    patch((current) => ({
      ...current,

      recommendationsAccepted: true,

      git: {
        ...current.git,
        enabled: recommendations.git,
      },

      ai: {
        ...current.ai,
        enabled: recommendations.ai,
      },
    }))

    onContinue()
  }

  return (
    <StepLayout
      title="Recommended setup"
      description="Based on how you plan to use Flux, this is a sensible starting point. Nothing here is permanent."
      onBack={onBack}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              patch((current) => ({
                ...current,
                recommendationsAccepted: false,
              }))

              onContinue()
            }}
          >
            Customize manually
          </Button>

          <Button onClick={accept}>Use recommended setup</Button>
        </>
      }
    >
      <div className="divide-y rounded-lg border">
        <RecommendationRow
          title="Backlinks & graph"
          description="Keep relationships between notes visible."
          enabled
        />

        <RecommendationRow
          title="Quick capture"
          description="Capture ideas without interrupting your current context."
          enabled={recommendations.quickCapture}
        />

        <RecommendationRow
          title="Git version history"
          description="Recover older versions and trace file changes."
          enabled={recommendations.git}
          recommended={recommendations.git}
        />

        <RecommendationRow
          title="AI tools"
          description="Ask, edit and work with your workspace using your own provider."
          enabled={recommendations.ai}
        />

        <RecommendationRow
          title="Prefer local AI"
          description="Put Ollama and LM Studio ahead of cloud providers."
          enabled={recommendations.preferLocalAI}
        />
      </div>

      {state.profile.experience === "simple" && (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Advanced developer controls will stay available in Settings without
          being shown throughout the default interface.
        </p>
      )}
    </StepLayout>
  )
}

// -----------------------------------------------------------------------------
// AI
// -----------------------------------------------------------------------------

function AIStep({
  state,
  patch,
  onBack,
  onContinue,
}: StepProps) {
  function setAIEnabled(enabled: boolean) {
    patch((current) => ({
      ...current,
      ai: {
        ...current.ai,
        enabled,
      },
    }))
  }

  function toggleProvider(id: string) {
    patch((current) => {
      const selected = current.ai.providers.includes(id)

      return {
        ...current,
        ai: {
          ...current.ai,
          providers: selected
            ? current.ai.providers.filter((provider) => provider !== id)
            : [...current.ai.providers, id],
        },
      }
    })
  }

  return (
    <StepLayout
      title="Use AI with Flux?"
      description="AI is optional. Flux is BYOM — bring your own model, account or local runtime."
      onBack={onBack}
      footer={
        <Button
          onClick={onContinue}
          disabled={state.ai.enabled === null}
        >
          Continue
          <ChevronRight className="size-4" />
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <ChoiceRow
          compact
          icon={Bot}
          title="Use AI"
          selected={state.ai.enabled === true}
          onClick={() => setAIEnabled(true)}
        />

        <ChoiceRow
          compact
          icon={X}
          title="Not now"
          selected={state.ai.enabled === false}
          onClick={() => setAIEnabled(false)}
        />
      </div>

      {state.ai.enabled && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-8 space-y-8"
        >
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium">Providers</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Select everything you want Flux to support.
              </p>
            </div>

            {Object.entries(AI_PROVIDERS).map(
              ([group, providers]) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {group}
                  </p>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {providers.map((provider) => (
                      <ProviderRow
                        key={provider.id}
                        name={provider.name}
                        group={group}
                        selected={state.ai.providers.includes(
                          provider.id
                        )}
                        onClick={() =>
                          toggleProvider(provider.id)
                        }
                      />
                    ))}
                  </div>
                </div>
              )
            )}
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Default AI mode</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose how much authority AI should have by default.
              </p>
            </div>

            <ChoiceRow
              icon={Search}
              title="Ask"
              description="Read workspace context and answer questions."
              selected={state.ai.mode === "ask"}
              onClick={() => setAIMode(patch, "ask")}
            />

            <ChoiceRow
              icon={FileText}
              title="Edit"
              description="Create and modify files with your approval."
              selected={state.ai.mode === "edit"}
              onClick={() => setAIMode(patch, "edit")}
            />

            <ChoiceRow
              icon={Bot}
              title="Agent"
              description="Perform multi-step work across the workspace."
              selected={state.ai.mode === "agent"}
              onClick={() => setAIMode(patch, "agent")}
            />
          </div>
        </motion.div>
      )}
    </StepLayout>
  )
}

// -----------------------------------------------------------------------------
// Git
// -----------------------------------------------------------------------------

function GitStep({
  state,
  patch,
  onBack,
  onContinue,
}: StepProps) {
  const detectGit = useCallback(async () => {
    patch((current) => ({
      ...current,
      git: {
        ...current.git,
        status: "checking",
      },
    }))

    if (!window.flux) {
      setTimeout(() => {
        patch((current) => ({
          ...current,
          git: {
            ...current.git,
            status: "installed",
            version: "git version 2.48.0",
          },
        }))
      }, 500)

      return
    }

    try {
      const result = await window.flux.git.detect()

      patch((current) => ({
        ...current,
        git: {
          ...current.git,
          status: result.installed ? "installed" : "missing",
          version: result.version,
        },
      }))
    } catch {
      patch((current) => ({
        ...current,
        git: {
          ...current.git,
          status: "missing",
        },
      }))
    }
  }, [patch])

  useEffect(() => {
    if (state.git.enabled && state.git.status === "idle") {
      void detectGit()
    }
  }, [detectGit, state.git.enabled, state.git.status])

  function enableGit() {
    patch((current) => ({
      ...current,
      git: {
        ...current.git,
        enabled: true,
        status: "idle",
      },
    }))
  }

  function disableGit() {
    patch((current) => ({
      ...current,

      git: {
        ...current.git,
        enabled: false,
      },

      publish: {
        enabled: false,
      },
    }))
  }

  return (
    <StepLayout
      title="Keep a history of your knowledge"
      description="Flux can use Git behind the scenes to recover older versions, trace changes and support publishing."
      onBack={onBack}
      footer={
        <Button onClick={onContinue}>
          Continue
          <ChevronRight className="size-4" />
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <ChoiceRow
          compact
          icon={GitBranch}
          title="Use Git"
          selected={state.git.enabled}
          onClick={enableGit}
          recommended
        />

        <ChoiceRow
          compact
          icon={X}
          title="Not now"
          selected={!state.git.enabled}
          onClick={disableGit}
        />
      </div>

      {state.git.enabled && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6"
        >
          {state.git.status === "checking" && (
            <StatusBox
              icon={Loader2}
              spinning
              title="Checking Git"
              description="Looking for Git on this system."
            />
          )}

          {state.git.status === "installed" && (
            <StatusBox
              icon={Check}
              title="Git is ready"
              description={state.git.version ?? "Git detected."}
              success
            />
          )}

          {state.git.status === "missing" && (
            <div className="rounded-lg border p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Git isn't installed
                </p>

                <p className="text-sm leading-5 text-muted-foreground">
                  Install Git, then come back and let Flux check again.
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    window.flux?.git.openInstallGuide()
                  }
                >
                  Installation guide
                </Button>

                <Button onClick={detectGit}>Check again</Button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </StepLayout>
  )
}

// -----------------------------------------------------------------------------
// Publishing
// -----------------------------------------------------------------------------

function PublishStep({
  state,
  patch,
  onBack,
  onContinue,
  onSetupGit,
}: StepProps & {
  onSetupGit: () => void
}) {
  const gitReady =
    state.git.enabled && state.git.status === "installed"

  return (
    <StepLayout
      title="Do you plan to publish from Flux?"
      description="You can turn a workspace into a website when you're ready. Publishing requires Git."
      onBack={onBack}
      footer={
        <Button
          onClick={() => {
            if (state.publish.enabled && !gitReady) {
              onSetupGit()
              return
            }

            onContinue()
          }}
        >
          {state.publish.enabled && !gitReady
            ? "Set up Git"
            : "Continue"}

          <ChevronRight className="size-4" />
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <ChoiceRow
          compact
          icon={Globe2}
          title="Yes"
          selected={state.publish.enabled}
          onClick={() =>
            patch((current) => ({
              ...current,
              publish: {
                enabled: true,
              },
            }))
          }
        />

        <ChoiceRow
          compact
          icon={X}
          title="Maybe later"
          selected={!state.publish.enabled}
          onClick={() =>
            patch((current) => ({
              ...current,
              publish: {
                enabled: false,
              },
            }))
          }
        />
      </div>

      {state.publish.enabled && !gitReady && (
        <div className="mt-5 rounded-lg border p-4">
          <div className="flex gap-3">
            <GitBranch className="mt-0.5 size-4 shrink-0" />

            <div>
              <p className="text-sm font-medium">Git is required</p>

              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Flux uses version control as the source of truth for published
                workspaces.
              </p>
            </div>
          </div>
        </div>
      )}
    </StepLayout>
  )
}

// -----------------------------------------------------------------------------
// Workspace
// -----------------------------------------------------------------------------

function WorkspaceStep({
  state,
  patch,
  onBack,
  onComplete,
}: Omit<StepProps, "onContinue"> & {
  onComplete: () => void
}) {
  async function chooseParentDirectory() {
    const path = await window.flux?.workspace.pickDirectory()

    if (!path) return

    patch((current) => ({
      ...current,
      workspace: {
        ...current.workspace,
        parentPath: path,
      },
    }))
  }

  async function chooseExistingWorkspace() {
    let path: string | null | undefined

    if (window.flux) {
      path = await window.flux.workspace.pickDirectory()
    } else {
      path = "/Users/example/Documents/my-notes"
    }

    if (!path) return

    patch((current) => ({
      ...current,
      workspace: {
        ...current.workspace,
        mode: "existing",
        path,
      },
    }))
  }

  async function createOrOpenWorkspace() {
    patch((current) => ({
      ...current,
      workspace: {
        ...current.workspace,
        creating: true,
        error: undefined,
      },
    }))

    try {
      if (state.workspace.mode === "new") {
        if (!state.workspace.name.trim()) {
          throw new Error("Enter a workspace name.")
        }

        if (!state.workspace.parentPath) {
          throw new Error("Choose where to create the workspace.")
        }

        const result = window.flux
          ? await window.flux.workspace.create({
              parentPath: state.workspace.parentPath,
              name: state.workspace.name.trim(),
              initGit: state.git.enabled,
            })
          : {
              path: `${state.workspace.parentPath}/${state.workspace.name}`,
            }

        patch((current) => ({
          ...current,
          workspace: {
            ...current.workspace,
            path: result.path,
            creating: false,
          },
        }))
      } else if (state.workspace.mode === "existing") {
        if (!state.workspace.path) {
          throw new Error("Choose a workspace folder.")
        }

        const result = window.flux
          ? await window.flux.workspace.open({
              path: state.workspace.path,
              initGit: state.git.enabled,
            })
          : {
              path: state.workspace.path,
            }

        patch((current) => ({
          ...current,
          workspace: {
            ...current.workspace,
            path: result.path,
            creating: false,
          },
        }))
      } else {
        throw new Error("Choose how you want to set up your workspace.")
      }

      onComplete()
    } catch (error) {
      patch((current) => ({
        ...current,
        workspace: {
          ...current.workspace,
          creating: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not create workspace.",
        },
      }))
    }
  }

  const canContinue =
    state.workspace.mode === "new"
      ? Boolean(
          state.workspace.name.trim() &&
            state.workspace.parentPath
        )
      : Boolean(
          state.workspace.mode === "existing" &&
            state.workspace.path
        )

  return (
    <StepLayout
      title="Set up your first workspace"
      description="A Flux workspace is simply a folder containing your notes and files."
      onBack={onBack}
      footer={
        <Button
          onClick={createOrOpenWorkspace}
          disabled={!canContinue || state.workspace.creating}
        >
          {state.workspace.creating && (
            <Loader2 className="size-4 animate-spin" />
          )}

          Create workspace
        </Button>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <ChoiceRow
          compact
          icon={Folder}
          title="New workspace"
          selected={state.workspace.mode === "new"}
          onClick={() =>
            patch((current) => ({
              ...current,
              workspace: {
                ...current.workspace,
                mode: "new",
              },
            }))
          }
        />

        <ChoiceRow
          compact
          icon={FolderOpen}
          title="Existing folder"
          selected={state.workspace.mode === "existing"}
          onClick={chooseExistingWorkspace}
        />
      </div>

      {state.workspace.mode === "new" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-name">
                Workspace name
              </FieldLabel>

              <Input
                id="workspace-name"
                value={state.workspace.name}
                placeholder="Personal Knowledge"
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    workspace: {
                      ...current.workspace,
                      name: event.target.value,
                    },
                  }))
                }
              />
            </Field>

            <Field>
              <FieldLabel>Location</FieldLabel>

              <Button
                variant="outline"
                className="justify-start font-normal"
                onClick={chooseParentDirectory}
              >
                <FolderOpen className="size-4" />

                {state.workspace.parentPath ||
                  "Choose a folder"}
              </Button>

              <FieldDescription>
                Flux will create the workspace inside this folder.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </motion.div>
      )}

      {state.workspace.mode === "existing" &&
        state.workspace.path && (
          <div className="mt-6 rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <FolderOpen className="mt-0.5 size-4 shrink-0" />

              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Existing workspace
                </p>

                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {state.workspace.path}
                </p>
              </div>
            </div>
          </div>
        )}

      {state.workspace.error && (
        <p className="mt-4 text-sm text-destructive">
          {state.workspace.error}
        </p>
      )}
    </StepLayout>
  )
}

// -----------------------------------------------------------------------------
// Done
// -----------------------------------------------------------------------------

function DoneStep({
  state,
  onOpen,
}: {
  state: OnboardingState
  onOpen: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <FluxMark />

      <div className="space-y-3">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 350,
            damping: 25,
          }}
          className="mx-auto flex size-10 items-center justify-center rounded-full border"
        >
          <Check className="size-5" />
        </motion.div>

        <h1 className="text-2xl font-semibold tracking-tight">
          You're all set
        </h1>

        <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
          Flux is ready. Your workspace is yours, your files stay yours, and
          everything you configured can be changed later.
        </p>
      </div>

      {state.workspace.path && (
        <div className="w-full max-w-sm rounded-lg border px-4 py-3 text-left">
          <p className="text-xs text-muted-foreground">Workspace</p>
          <p className="mt-1 truncate text-sm">
            {state.workspace.path}
          </p>
        </div>
      )}

      <Button className="w-full max-w-sm" onClick={onOpen}>
        Open Flux
        <ChevronRight className="size-4" />
      </Button>

      <p className="text-xs text-muted-foreground">
        Welcome to Flux.
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Reusable UI
// -----------------------------------------------------------------------------

interface StepProps {
  state: OnboardingState
  patch: (
    updater:
      | Partial<OnboardingState>
      | ((current: OnboardingState) => OnboardingState)
  ) => void
  onBack: () => void
  onContinue: () => void
}

function StepLayout({
  title,
  description,
  children,
  footer,
  onBack,
}: {
  title: string
  description: string
  children: React.ReactNode
  footer: React.ReactNode
  onBack: () => void
}) {
  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          {title}
        </h1>

        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>

      <div>{children}</div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">{footer}</div>
      </div>
    </div>
  )
}

function FluxMark({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center",
        compact ? "gap-2" : "flex-col gap-2"
      )}
    >
      <div className="flex size-8 items-center justify-center rounded-md border">
        <Brain className="size-4" />
      </div>

      {!compact && (
        <span className="sr-only">Flux</span>
      )}

      {compact && (
        <span className="text-sm font-medium">Flux</span>
      )}
    </div>
  )
}

function ChoiceRow({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
  compact = false,
  recommended = false,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  selected: boolean
  onClick: () => void
  compact?: boolean
  recommended?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "group relative flex w-full cursor-pointer items-start gap-3 rounded-lg border text-left outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        compact ? "p-3" : "p-4",
        selected
          ? "border-foreground bg-accent"
          : "border-border hover:bg-accent/50"
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
        <Icon className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>

          {recommended && (
            <span className="text-[10px] text-muted-foreground">
              Recommended
            </span>
          )}
        </div>

        {description && !compact && (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      <div
        className={cn(
          "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40"
        )}
      >
        {selected && <Check className="size-2.5" />}
      </div>
    </button>
  )
}

function PermissionRow({
  icon: Icon,
  title,
  description,
  status,
  action,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  status:
    | "granted"
    | "optional"
    | "checking"
    | "later"
    | "not-applicable"
  action?: React.ReactNode
}) {
  const label = {
    granted: "Enabled",
    optional: "Optional",
    checking: "Checking",
    later: "Choose later",
    "not-applicable": "Not required",
  }[status]

  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>

        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {description}
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {status === "checking" && (
              <Loader2 className="size-3 animate-spin" />
            )}

            {status === "granted" && (
              <Check className="size-3" />
            )}

            {label}
          </span>

          {action}
        </div>
      </div>
    </div>
  )
}

function RecommendationRow({
  title,
  description,
  enabled,
  recommended = false,
}: {
  title: string
  description: string
  enabled: boolean
  recommended?: boolean
}) {
  return (
    <div className="flex gap-3 p-4">
      <div
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          enabled
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/30"
        )}
      >
        {enabled && <Check className="size-2.5" />}
      </div>

      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{title}</p>

          {recommended && (
            <span className="text-[10px] text-muted-foreground">
              Recommended
            </span>
          )}
        </div>

        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

function ProviderRow({
  name,
  group,
  selected,
  onClick,
}: {
  name: string
  group: string
  selected: boolean
  onClick: () => void
}) {
  const Icon =
    group === "Local"
      ? Cpu
      : group === "Agent / CLI"
        ? Terminal
        : Cloud

  return (
    <ChoiceRow
      compact
      icon={Icon}
      title={name}
      selected={selected}
      onClick={onClick}
    />
  )
}

function StatusBox({
  icon: Icon,
  title,
  description,
  success,
  spinning,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  success?: boolean
  spinning?: boolean
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            spinning && "animate-spin"
          )}
        />

        <div>
          <p className="text-sm font-medium">{title}</p>

          <p className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>

          {success && (
            <p className="mt-2 text-xs text-muted-foreground">
              Validation passed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Recommendation logic
// -----------------------------------------------------------------------------

function buildRecommendations(state: OnboardingState) {
  const uses = state.profile.useCases
  const power = state.profile.experience === "power"

  const developer = uses.includes("development")
  const research = uses.includes("research")
  const study = uses.includes("study")
  const writing = uses.includes("writing")
  const work = uses.includes("work")

  return {
    quickCapture:
      study || research || writing || work,

    git:
      power || developer || writing || research,

    ai:
      study ||
      research ||
      developer ||
      writing ||
      work,

    preferLocalAI:
      power || developer,
  }
}

function setExperience(
  patch: StepProps["patch"],
  experience: Experience
) {
  patch((current) => ({
    ...current,
    profile: {
      ...current.profile,
      experience,
    },
  }))
}

function setAIMode(
  patch: StepProps["patch"],
  mode: AIMode
) {
  patch((current) => ({
    ...current,
    ai: {
      ...current.ai,
      mode,
    },
  }))
}