"use server";

import { revalidatePath } from "next/cache";
import { markNotificationRead } from "./notifications";
import {
  markAssignmentViewed,
  acceptAssignment,
  declineAssignment,
} from "@/modules/assignments/assignments";

export async function markNotificationReadAction(
  organizationSlug: string,
  notificationId: string,
) {
  await markNotificationRead(organizationSlug, notificationId);
  revalidatePath(`/org/${organizationSlug}/notifications`);
}

export async function markAssignmentViewedAction(
  organizationSlug: string,
  assignmentId: string,
) {
  await markAssignmentViewed(organizationSlug, assignmentId);
  revalidatePath(`/org/${organizationSlug}/notifications`);
}

export async function acceptAssignmentAction(
  organizationSlug: string,
  assignmentId: string,
) {
  await acceptAssignment(organizationSlug, assignmentId);
  revalidatePath(`/org/${organizationSlug}/notifications`);
}

export async function declineAssignmentAction(
  organizationSlug: string,
  assignmentId: string,
) {
  await declineAssignment(organizationSlug, assignmentId);
  revalidatePath(`/org/${organizationSlug}/notifications`);
}
