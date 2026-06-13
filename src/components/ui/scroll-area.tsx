import * as React from "react"

import { cn } from "@/lib/utils"

// ScrollArea — a thin overflow-auto container used to bound scrollable regions.
// No Base UI dependency needed; plain div with overflow-auto.
// Usage: <ScrollArea className="max-h-[28rem]">...</ScrollArea>
function ScrollArea({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area"
      className={cn("relative overflow-auto", className)}
      {...props}
    />
  )
}

export { ScrollArea }
