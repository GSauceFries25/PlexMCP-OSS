"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useCreateOrganization } from "@/lib/api/hooks";
import { useAuth } from "@/providers/auth-provider";
import { Plus } from "lucide-react";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

interface CreateOrganizationDialogProps {
  trigger?: React.ReactNode;
}

export function CreateOrganizationDialog({ trigger }: CreateOrganizationDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const createOrg = useCreateOrganization();
  const { refreshOrganizations, setCurrentOrganization } = useAuth();

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(generateSlug(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Organization name is required");
      return;
    }

    if (!slug.trim()) {
      toast.error("URL slug is required");
      return;
    }

    try {
      const newOrg = await createOrg.mutateAsync({ name: name.trim(), slug: slug.trim() });
      await refreshOrganizations();
      setCurrentOrganization(newOrg);
      toast.success("Organization created successfully");
      setOpen(false);
      setName("");
      setSlug("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create organization");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Organization
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>
            Create a new organization to start using PlexMCP.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                placeholder="My Organization"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">URL Slug</Label>
              <Input
                id="org-slug"
                placeholder="my-organization"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
              />
              <p className="text-sm text-muted-foreground">
                plexmcp.com/org/{slug || "your-slug"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createOrg.isPending || !name || !slug}>
              {createOrg.isPending ? "Creating..." : "Create Organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
