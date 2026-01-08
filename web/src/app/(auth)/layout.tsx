import Link from "next/link";
import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20 px-4">
      <div className="mb-8">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="PlexMCP" width={40} height={40} />
          <span className="text-2xl font-bold">PlexMCP</span>
        </Link>
      </div>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} PlexMCP. All rights reserved.
      </p>
    </div>
  );
}
