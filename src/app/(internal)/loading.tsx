import { InternalPageSkeleton } from "../../components/ui/list-states";

/*
 * One Suspense boundary for every internal route below InternalShell. Without
 * it a sidebar click waits for the whole destination RSC payload with the
 * shell's outgoing flip already at opacity 0, which reads as a blank pane.
 * Routes with their own loading.tsx (Operations, All Conversations) still win.
 */
export default function InternalLoading() {
  return <InternalPageSkeleton />;
}
