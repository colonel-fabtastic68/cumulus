import { redirect } from "next/navigation";

/** The Workspaces page moved into Account. */
export default function WorkspacesRedirect() {
  redirect("/account");
}
