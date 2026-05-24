import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { DocWorkspace } from "@/src/components/DocWorkspace";

export default async function DocPage() {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect("/auth/login");
  }

  const user = session.user;

  return (
    <DocWorkspace
      userEmail={typeof user.email === "string" ? user.email : ""}
      userName={typeof user.name === "string" ? user.name : ""}
      userAvatar={typeof user.picture === "string" ? user.picture : ""}
    />
  );
}
