/**
 * Mock for all shadcn/ui component imports during Jest tests.
 *
 * Tests that only exercise pure TypeScript logic (helpers, hooks, utils) run in
 * the Node environment without a real DOM, so React JSX rendering is never
 * invoked. These thin stubs satisfy TypeScript's module resolution and prevent
 * "Cannot find module '@/components/ui/…'" errors without requiring jsdom.
 */

// Generic passthrough used for every exported React component
const noop = () => null;

// Primitive components
export const Button = noop;
export const Input = noop;
export const Label = noop;
export const Badge = noop;
export const Progress = noop;

// Card family
export const Card = noop;
export const CardHeader = noop;
export const CardTitle = noop;
export const CardContent = noop;

// Alert family
export const Alert = noop;
export const AlertDescription = noop;

// Select family
export const Select = noop;
export const SelectContent = noop;
export const SelectItem = noop;
export const SelectTrigger = noop;
export const SelectValue = noop;

// Tabs family
export const Tabs = noop;
export const TabsContent = noop;
export const TabsList = noop;
export const TabsTrigger = noop;

// Dialog family
export const Dialog = noop;
export const DialogContent = noop;
export const DialogHeader = noop;
export const DialogTitle = noop;
export const DialogDescription = noop;
export const DialogFooter = noop;

// Dropdown family
export const DropdownMenu = noop;
export const DropdownMenuContent = noop;
export const DropdownMenuItem = noop;
export const DropdownMenuTrigger = noop;
