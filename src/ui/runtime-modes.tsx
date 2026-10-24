import { LockIcon, LockOpenIcon, PenLineIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { RuntimeMode } from "@/lib/t3";

// Labels, descriptions and icons match T3 Code's runtime mode picker.
export const RUNTIME_MODE_DETAILS: Record<RuntimeMode, { label: string; description: string; icon: ReactNode }> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: <LockIcon />,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: <PenLineIcon />,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: <SparklesIcon />,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: <LockOpenIcon />,
  },
};
