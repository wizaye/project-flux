import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible";
import { Field, FieldLabel } from "../../ui/field";
import { Slider } from "../../ui/slider";
import { Switch } from "../../ui/switch";

export function GraphSection({ title, children, actions, defaultOpen = false }: {
  title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean;
}) {
  return <Collapsible defaultOpen={defaultOpen} className="border-t first:border-t-0">
    <div className="flex items-center px-1">
      <CollapsibleTrigger render={<Button variant="ghost" className="group h-9 min-w-0 flex-1 justify-start gap-1 px-2 text-xs" />}>
        <ChevronDown className="size-3.5 -rotate-90 group-aria-expanded:rotate-0" />{title}
      </CollapsibleTrigger>
      {actions}
    </div>
    <CollapsibleContent className="space-y-3 px-3 pb-3">{children}</CollapsibleContent>
  </Collapsible>;
}

export function GraphSwitch({ label, checked, onCheckedChange }: {
  label: string; checked: boolean; onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return <Field orientation="horizontal">
    <FieldLabel htmlFor={id} className="text-xs font-normal">{label}</FieldLabel>
    <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
  </Field>;
}

export function GraphSlider({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void;
}) {
  const id = useId();
  return <Field>
    <FieldLabel id={id} className="text-xs font-normal">{label}</FieldLabel>
    <Slider aria-labelledby={id} value={[value]} min={min} max={max} step={step}
      onValueChange={(next) => onChange(Array.isArray(next) ? next[0]! : next)} />
  </Field>;
}
