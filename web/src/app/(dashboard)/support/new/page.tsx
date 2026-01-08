"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useCreateTicket } from "@/lib/api/hooks";
import { useOrganizationId } from "@/providers/auth-provider";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  type TicketCategory,
  type TicketPriority,
} from "@/types/support";

export default function NewTicketPage() {
  const router = useRouter();
  const organizationId = useOrganizationId();
  const createTicket = useCreateTicket(organizationId);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("general");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [content, setContent] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }

    if (!content.trim()) {
      toast.error("Please describe your issue");
      return;
    }

    try {
      const ticket = await createTicket.mutateAsync({
        subject: subject.trim(),
        category,
        priority,
        content: content.trim(),
      });

      toast.success("Ticket created successfully!");
      router.push(`/support/${ticket?.id || ""}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create ticket");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/support"
        className="inline-flex items-center text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to My Tickets
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Submit a Ticket
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400">
          Describe your issue and our support team will get back to you
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Ticket Details</CardTitle>
          <CardDescription>
            Please provide as much detail as possible to help us resolve your issue quickly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="subject">Subject *</Label>
              <Input
                id="subject"
                placeholder="Brief summary of your issue"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
              />
              <p className="text-xs text-neutral-500">{subject.length}/200 characters</p>
            </div>

            {/* Category & Priority */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)}>
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                  <SelectTrigger id="priority">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TICKET_PRIORITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="content">Description *</Label>
              <Textarea
                id="content"
                placeholder="Please describe your issue in detail. Include any relevant information such as:
- What you were trying to do
- What happened instead
- Any error messages you saw
- Steps to reproduce the issue"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
              />
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-4">
              <Link href="/support">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={createTicket.isPending}>
                {createTicket.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit Ticket
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Help text */}
      <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
        Need immediate help? Check our{" "}
        <Link href="/help" className="text-blue-600 hover:underline dark:text-blue-400">
          FAQ
        </Link>{" "}
        or join our{" "}
        <a
          href="https://discord.gg/HAYYTGnht8"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          Discord community
        </a>
        .
      </p>
    </div>
  );
}
