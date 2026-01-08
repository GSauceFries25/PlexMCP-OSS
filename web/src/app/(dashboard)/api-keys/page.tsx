import { redirect } from "next/navigation";

// Redirect old /api-keys to new /connections
export default function ApiKeysPage() {
  redirect("/connections");
}
