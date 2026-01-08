"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { WebsiteGoal, CreateGoalRequest, UpdateGoalRequest } from "@/lib/api/client";

interface GoalFormProps {
  goal: WebsiteGoal | null;
  onSubmit: (data: CreateGoalRequest | UpdateGoalRequest) => Promise<void>;
  onCancel: () => void;
}

export function GoalForm({ goal, onSubmit, onCancel }: GoalFormProps) {
  const [name, setName] = useState(goal?.name || "");
  const [description, setDescription] = useState(goal?.description || "");
  const [goalType, setGoalType] = useState<string>(goal?.goal_type || "pageview");
  const [eventName, setEventName] = useState(goal?.event_name || "");
  const [urlPattern, setUrlPattern] = useState(goal?.url_pattern || "");
  const [minDuration, setMinDuration] = useState(goal?.min_duration_seconds?.toString() || "");
  const [minPageViews, setMinPageViews] = useState(goal?.min_page_views?.toString() || "");
  const [isActive, setIsActive] = useState(goal?.is_active ?? true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const data: CreateGoalRequest | UpdateGoalRequest = {
        name,
        description: description || undefined,
        goal_type: goalType,
        event_name: goalType === "event" ? eventName : undefined,
        url_pattern: goalType === "pageview" ? urlPattern : undefined,
        min_duration_seconds: goalType === "duration" ? parseInt(minDuration) : undefined,
        min_page_views: goalType === "engagement" ? parseInt(minPageViews) : undefined,
      };

      if (goal) {
        (data as UpdateGoalRequest).is_active = isActive;
      }

      await onSubmit(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{goal ? "Edit Goal" : "Create Goal"}</DialogTitle>
        <DialogDescription>
          {goal ? "Update the conversion goal settings" : "Define a new conversion goal to track"}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Goal Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Newsletter Signup"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this goal tracks..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="goal_type">Goal Type</Label>
          <Select value={goalType} onValueChange={setGoalType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pageview">Page View</SelectItem>
              <SelectItem value="event">Custom Event</SelectItem>
              <SelectItem value="duration">Session Duration</SelectItem>
              <SelectItem value="engagement">Page Views per Session</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {goalType === "pageview" && (
          <div className="space-y-2">
            <Label htmlFor="url_pattern">URL Pattern (regex)</Label>
            <Input
              id="url_pattern"
              value={urlPattern}
              onChange={(e) => setUrlPattern(e.target.value)}
              placeholder="e.g., /thank-you.*"
            />
          </div>
        )}

        {goalType === "event" && (
          <div className="space-y-2">
            <Label htmlFor="event_name">Event Name</Label>
            <Input
              id="event_name"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g., form_submit"
            />
          </div>
        )}

        {goalType === "duration" && (
          <div className="space-y-2">
            <Label htmlFor="min_duration">Minimum Duration (seconds)</Label>
            <Input
              id="min_duration"
              type="number"
              value={minDuration}
              onChange={(e) => setMinDuration(e.target.value)}
              placeholder="e.g., 60"
            />
          </div>
        )}

        {goalType === "engagement" && (
          <div className="space-y-2">
            <Label htmlFor="min_page_views">Minimum Page Views</Label>
            <Input
              id="min_page_views"
              type="number"
              value={minPageViews}
              onChange={(e) => setMinPageViews(e.target.value)}
              placeholder="e.g., 3"
            />
          </div>
        )}

        {goal && (
          <div className="flex items-center justify-between">
            <Label htmlFor="is_active">Active</Label>
            <Switch
              id="is_active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading || !name}>
          {loading ? "Saving..." : goal ? "Update Goal" : "Create Goal"}
        </Button>
      </DialogFooter>
    </form>
  );
}
