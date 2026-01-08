"use client";

import { useState } from "react";
import { User, UserX, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useAdminAssignTicket } from "@/lib/api/hooks";

interface AssignmentModalProps {
  ticketId: string;
  currentAssignee?: {
    id: string;
    email: string;
    name?: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned?: () => void;
}

interface StaffMember {
  id: string;
  email: string;
  platform_role: string;
}

export function AssignmentModal({
  ticketId,
  currentAssignee,
  open,
  onOpenChange,
  onAssigned,
}: AssignmentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch staff members when modal opens
  const { data: staff, isLoading: staffLoading } = useQuery({
    queryKey: ["admin", "support", "staff"],
    queryFn: async () => {
      const response = await apiClient.getAdminStaff();
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data as StaffMember[];
    },
    enabled: open,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const assignTicket = useAdminAssignTicket();

  const handleAssign = async (userId: string | null) => {
    setIsSubmitting(true);
    try {
      await assignTicket.mutateAsync({
        ticketId,
        assignToUserId: userId,
      });
      toast.success(userId ? "Ticket assigned successfully!" : "Ticket unassigned successfully!");
      onOpenChange(false);
      onAssigned?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update ticket assignment");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Ticket</DialogTitle>
          <DialogDescription>
            Select a staff member to assign this ticket, or unassign it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {/* Unassign Option */}
          <Button
            variant={!currentAssignee ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => handleAssign(null)}
            disabled={isSubmitting || staffLoading}
          >
            <UserX className="h-4 w-4 mr-2" />
            <span>Unassign</span>
            {!currentAssignee && (
              <CheckCircle className="h-4 w-4 ml-auto text-blue-600" />
            )}
          </Button>

          <Separator />

          {/* Staff List */}
          {staffLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          ) : staff && staff.length > 0 ? (
            <div className="space-y-1">
              {staff.map((member) => (
                <Button
                  key={member.id}
                  variant={currentAssignee?.id === member.id ? "secondary" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => handleAssign(member.id)}
                  disabled={isSubmitting}
                >
                  <User className="h-4 w-4 mr-2" />
                  <span className="text-sm font-medium flex-1">
                    {member.email}
                  </span>
                  {currentAssignee?.id === member.id && (
                    <CheckCircle className="h-4 w-4 ml-2 text-blue-600" />
                  )}
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-neutral-500">
              No staff members available
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
