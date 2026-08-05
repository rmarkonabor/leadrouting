# Lead Routing SaaS Platform

# Final Phase 1 Product and Development Specification

## 1. Product Overview

Build a secure multi tenant SaaS platform that captures leads from external forms, APIs, webhooks, and manual submissions, then routes each lead to the most appropriate user based on location, configurable business rules, user eligibility, availability, working hours, and capacity.

The platform must track whether the assigned user accepts or declines the lead. If the assignment is declined or expires, the platform must automatically attempt reassignment.

The platform should also provide administrators with visibility into every routing decision, assignment attempt, routing failure, integration failure, and manual intervention.

The platform is not intended to replace a complete CRM.

It should act as the routing and accountability layer between:

```text
Lead source
Routing platform
Assigned user
External CRM
```

The core value proposition is:

> Capture leads from any source, route them using territories and custom rules, automatically reassign unanswered leads, and keep the existing CRM updated.

## 2. Initial Market Positioning

The system architecture must remain industry neutral.

The initial customer experience may focus on real estate brokerages and distributed sales teams because they commonly have:

1. Multiple lead sources.
2. Several agents.
3. Geographic service areas.
4. Existing CRM systems.
5. Response time requirements.
6. User availability changes.
7. Lead ownership disputes.
8. High value inbound opportunities.

The database, routing engine, forms, and interface must not permanently use real estate specific terminology.

Business specific information must be created using custom variables.

Examples include:

1. Property type.
2. Insurance type.
3. Mortgage amount.
4. Purchase budget.
5. Preferred language.
6. Service category.
7. Product category.
8. Qualification status.

## 3. Phase 1 Objectives

Phase 1 must prove that the application can reliably complete this workflow:

1. Receive a lead from an external source.
2. Identify the correct organization and lead source.
3. Map incoming fields into standard fields and custom variables.
4. Validate the submitted information.
5. Detect possible duplicates.
6. Normalize the submitted location.
7. Select the correct published routing flow.
8. Evaluate routing rules in priority order.
9. Identify eligible teams and users.
10. Apply territory, availability, working hour, attribute, and capacity filters.
11. Select a user using a supported assignment method.
12. Create exactly one active assignment.
13. Notify the selected user.
14. Require the selected user to accept or decline.
15. Automatically expire unanswered assignments.
16. Reassign declined or expired leads.
17. Send unresolved leads into manual review.
18. Explain every routing and assignment decision.
19. Send the lead and assignment to an external CRM.
20. Record every important event in an activity timeline.
21. Show routing, assignment, and integration health to administrators.

The product is successful when organizations trust it to distribute live leads without manually monitoring every submission.

## 4. Approved Technology Stack

Use the following technology stack:

```text
Next.js App Router
React
TypeScript with strict mode
Supabase PostgreSQL
Supabase Auth
Supabase Row Level Security
Supabase SQL migrations
Supabase database functions
Supabase Queues
Supabase Cron
Supabase Edge Functions when necessary
Supabase PostGIS extension
Zod
Vitest
Playwright before customer pilots
Sentry
Vercel
GitHub
GitHub Actions
```

Use Vercel for:

1. Hosting the Next.js application.
2. Hosting public application routes.
3. Hosting lead intake endpoints.
4. Preview deployments.
5. Production deployments.
6. Environment variable management.

Use Supabase for:

1. PostgreSQL.
2. Authentication.
3. Organization membership.
4. Row Level Security.
5. SQL migrations.
6. Database functions.
7. Geographic processing.
8. Queued background work.
9. Scheduled jobs.
10. Internal data storage.

Use GitHub for:

1. Source control.
2. Feature branches.
3. Pull requests.
4. Migration history.
5. Automated tests.
6. Deployment integration.

Use Sentry for:

1. Browser error monitoring.
2. Server error monitoring.
3. Route handler errors.
4. Server Action errors.
5. Routing failures.
6. Background job failures.
7. CRM integration failures.
8. Webhook delivery failures.
9. Source map support.
10. Production alerts.

Do not add:

```text
Redis
BullMQ
pg_boss
Drizzle
Prisma
Another authentication provider
Another database provider
Another queue provider
Another error monitoring provider
```

## 5. Phase 1 Scope

Phase 1 includes:

1. Authentication.
2. Organizations.
3. User invitations.
4. Roles and permissions.
5. Teams.
6. User availability.
7. User working hours.
8. User capacity.
9. Assignment weights.
10. Custom recipient attributes.
11. Bulk user import.
12. Lead sources.
13. API lead intake.
14. Webhook lead intake.
15. Manual lead entry.
16. Field mapping.
17. Custom lead variables.
18. Lead validation.
19. Submission logs.
20. Failed submission recovery.
21. Basic duplicate detection.
22. Location normalization.
23. Service territories.
24. Territory import.
25. Territory conflict warnings.
26. Routing flows.
27. Versioned routing rules.
28. Routing simulator.
29. Direct assignment.
30. Team round robin.
31. Weighted round robin.
32. User eligibility filtering.
33. Assignment acceptance.
34. Assignment decline.
35. Assignment expiration.
36. Automatic reassignment.
37. Manual review.
38. Manual assignment.
39. Manual reassignment.
40. Routing explanations.
41. Basic lead list.
42. Lead detail page.
43. Custom lead statuses.
44. Notes.
45. Activity timeline.
46. Email notifications.
47. In application notifications.
48. Generic outbound webhooks.
49. One external CRM adapter.
50. Integration logs.
51. Routing health dashboard.
52. Basic audit logs.
53. Sentry monitoring.
54. GitHub Actions.
55. Production readiness documentation.

## 6. Explicitly Excluded Scope

Do not build these features in Phase 1:

1. Calling.
2. SMS conversations.
3. Email conversations.
4. Call recording.
5. Calendar scheduling.
6. Appointment booking.
7. Marketing automation.
8. Drip campaigns.
9. A complete CRM.
10. A visual sales pipeline.
11. Sales forecasting.
12. Quotes.
13. Invoices.
14. Commission management.
15. Lead auctions.
16. Lead selling.
17. Buyer billing.
18. Artificial intelligence routing.
19. Performance based routing.
20. Artificial intelligence lead qualification.
21. Artificial intelligence summaries.
22. Custom map polygon drawing.
23. Native mobile applications.
24. A full hosted form design system.
25. Multiple direct CRM integrations.
26. Historical CRM activity imports.
27. Advanced reporting builders.
28. Advanced lead merging.
29. First to claim routing.
30. Multiple workspaces within one organization.
31. Public integration marketplace.
32. Subscription billing automation.

## 7. Core Product Terminology

### 7.1 Organization

An organization is one customer account.

Examples include:

1. A brokerage.
2. An insurance agency.
3. A mortgage company.
4. A franchise group.
5. A home services company.

Every customer owned record must belong to one organization.

### 7.2 Team

A team is a group of users who may receive leads.

Examples include:

1. Toronto Team.
2. Florida Team.
3. Residential Team.
4. Commercial Team.
5. Auto Insurance Team.

### 7.3 User

A user is a person who can access the application.

### 7.4 Lead Source

A lead source identifies where a lead originated.

Examples include:

1. Website form.
2. Landing page.
3. Partner website.
4. External API.
5. CRM webhook.
6. Manual entry.
7. CSV import.

### 7.5 Custom Lead Variable

A custom lead variable is an organization defined field attached to a lead.

Examples include:

1. Property type.
2. Budget.
3. Insurance product.
4. Preferred language.
5. Service category.

### 7.6 Recipient Attribute

A recipient attribute is an organization defined property attached to a user.

Examples include:

1. Supported language.
2. Licence type.
3. Certification.
4. Specialization.
5. Supported service.

### 7.7 Territory

A territory is a geographic area served by a team or user.

### 7.8 Routing Flow

A routing flow is a versioned collection of ordered routing rules.

### 7.9 Routing Rule

A routing rule contains conditions, eligibility requirements, and an assignment action.

### 7.10 Assignment

An assignment represents one attempt to assign a lead to a user or team.

## 8. User Roles

Phase 1 should use three customer facing roles.

### 8.1 Organization Administrator

The organization administrator can:

1. Manage organization settings.
2. Invite users.
3. Deactivate users.
4. Assign roles.
5. Create teams.
6. Manage team membership.
7. Configure territories.
8. Configure availability and capacity.
9. Create recipient attributes.
10. Create lead sources.
11. Create custom lead variables.
12. Configure field mappings.
13. Create routing flows.
14. Publish routing flows.
15. Test routing flows.
16. View all organization leads.
17. Manually assign leads.
18. Manually reassign leads.
19. Resolve manual review items.
20. Configure integrations.
21. Configure outbound webhooks.
22. Review submission logs.
23. Review integration logs.
24. Review audit logs.
25. Export organization data.

### 8.2 Team Manager

The team manager can:

1. View leads assigned to permitted teams.
2. View users belonging to permitted teams.
3. Review pending assignments for permitted teams.
4. Manually assign leads within permitted teams.
5. Manually reassign leads within permitted teams.
6. Resolve permitted manual review items.
7. Add notes.
8. View team routing health.
9. View team assignment performance.

### 8.3 Agent

The agent can:

1. View leads assigned to them.
2. Accept assignments.
3. Decline assignments.
4. Update lead status.
5. Add notes.
6. View lead activity.
7. Change personal availability.
8. View current capacity.
9. View pending assignments.

## 9. Multi Tenant Architecture

Every tenant owned table must contain:

```text
organization_id
```

Organization isolation must be enforced through:

1. Supabase Row Level Security.
2. Server side authorization.
3. Organization scoped database queries.
4. Database constraints.
5. Organization membership validation.

The application must never trust an `organization_id` supplied by the browser.

The active organization must be resolved using:

1. The authenticated user.
2. Verified organization membership.
3. The requested organization context.
4. Server side authorization.

A user must never access records belonging to another organization.

This applies to:

1. Leads.
2. Users.
3. Teams.
4. Territories.
5. Routing flows.
6. Routing versions.
7. Assignments.
8. Activities.
9. Integrations.
10. Webhooks.
11. Logs.
12. Custom variables.
13. Recipient attributes.
14. Imports.

## 10. Authentication

Use Supabase Auth.

Support:

1. Email and password login.
2. Email verification.
3. Password reset.
4. Invitation based registration.
5. Session renewal.
6. Sign out.
7. User deactivation.

User statuses:

```text
invited
active
inactive
suspended
```

An inactive or suspended user must not access protected application pages.

An inactive or suspended user must not receive new lead assignments.

## 11. Teams

An organization administrator can create teams and assign users to one or more teams.

Team fields:

```text
id
organization_id
name
description
status
default_assignment_method
default_acceptance_deadline_minutes
default_fallback_user_id
timezone
operating_hours
created_at
updated_at
```

Team statuses:

```text
active
inactive
```

An inactive team must not receive automatic assignments.

## 12. User Availability and Capacity

Each user should have assignment settings.

```text
accept_leads
availability_status
timezone
working_hours
daily_lead_limit
active_lead_limit
assignment_weight
```

Availability statuses:

```text
available
busy
away
vacation
offline
```

An automatically assigned user must:

1. Be active.
2. Belong to the correct organization.
3. Belong to the selected team when team membership is required.
4. Be allowed to receive leads.
5. Be available.
6. Be within configured working hours.
7. Be below the daily lead limit.
8. Be below the active lead limit.
9. Match the required territory.
10. Match required recipient attributes.
11. Not have declined the same lead.
12. Not be excluded by the routing rule.

Administrators may override availability and capacity during manual assignment.

## 13. Custom Recipient Attributes

Organizations can create recipient attributes.

Examples include:

1. Licence type.
2. Certification.
3. Specialization.
4. Supported language.
5. Supported product.
6. Supported service.
7. Seniority.
8. Agent category.

Supported attribute types:

```text
text
long_text
number
currency
boolean
date
datetime
single_select
multi_select
email
phone
url
```

Recipient attribute definition fields:

```text
id
organization_id
name
internal_key
description
field_type
required
default_value
options
validation_rules
active
created_at
updated_at
```

The internal key must be unique within the organization.

Routing rules may compare lead custom variables with recipient attributes.

Example:

```text
Lead custom variable preferred_language
matches
Recipient attribute supported_languages
```

## 14. Bulk User Import

Administrators must be able to upload a CSV containing:

1. User name.
2. Email.
3. Role.
4. Team.
5. Availability.
6. Time zone.
7. Working hours.
8. Daily lead capacity.
9. Active lead capacity.
10. Assignment weight.
11. Recipient attributes.
12. Territory information.

The import workflow must include:

1. File upload.
2. Column mapping.
3. Validation preview.
4. Duplicate detection.
5. Error display.
6. Import confirmation.
7. Transactional import.
8. Import summary.
9. Downloadable error file.

Invalid imports must not partially create records unless the administrator explicitly chooses partial processing.

## 15. Default Lead Information

Only universal lead fields should exist by default.

### 15.1 Identity Fields

```text
first_name
last_name
full_name
email
phone
```

### 15.2 Basic Location Fields

```text
street_address
unit_number
neighborhood
city
county
state_province
postal_code
country
```

### 15.3 Source Information

```text
lead_source_id
external_submission_id
message
campaign
medium
referrer
landing_page
```

### 15.4 Consent Information

```text
email_consent
sms_consent
privacy_consent
consent_text
consent_timestamp
consent_ip
```

### 15.5 System Information

```text
id
organization_id
assigned_team_id
assigned_user_id
lead_status
assignment_status
priority
duplicate_status
created_at
updated_at
```

Do not create these as default lead fields:

```text
latitude
longitude
location_confidence
product_type
service_type
industry
budget
preferred_language
```

Coordinates and geographic metadata may exist internally for routing calculations.

They must not be displayed as normal customer editable lead fields.

## 16. Custom Lead Variables

Organizations can create custom lead variables.

Supported types:

```text
text
long_text
number
currency
boolean
date
datetime
single_select
multi_select
email
phone
url
```

Custom variable definition fields:

```text
id
organization_id
name
internal_key
description
field_type
required
default_value
options
validation_rules
active
created_at
updated_at
```

Custom lead variables must be usable in:

1. Lead intake.
2. Field mapping.
3. Validation.
4. Routing conditions.
5. Lead filters.
6. Optional lead columns.
7. Webhook payloads.
8. CRM field mappings.
9. CSV exports.

Unknown custom variable handling should support:

```text
reject_unknown_variables
ignore_unknown_variables
store_for_review
```

The recommended default is:

```text
store_for_review
```

## 17. Lead Sources

Lead source types:

```text
api
webhook
external_form
manual
csv
crm
```

Lead source fields:

```text
id
organization_id
name
source_type
status
source_token_hash
default_routing_flow_id
rate_limit_settings
signature_settings
created_at
updated_at
```

Source statuses:

```text
active
inactive
```

The application does not need a complete form builder.

It should provide:

1. A secure intake endpoint.
2. A source token.
3. Example request code.
4. Field mapping.
5. A test submission tool.
6. Submission logs.

## 18. Lead Intake API

Primary endpoint:

```text
POST /api/v1/intake/[sourceToken]
```

The endpoint must support:

1. JSON requests.
2. Form encoded requests.
3. Idempotency keys.
4. External submission identifiers.
5. Request rate limiting.
6. Optional signature verification.
7. Test mode.
8. Structured errors.

Example incoming request:

```json
{
  "first_name": "John",
  "last_name": "Smith",
  "email": "john@example.com",
  "phone": "+14165551234",
  "neighborhood": "Downtown",
  "city": "Toronto",
  "state_province": "Ontario",
  "postal_code": "M5V 1J2",
  "country": "Canada",
  "message": "I would like more information.",
  "property_category": "Condo",
  "estimated_budget": 900000
}
```

Incoming field names do not need to match internal field names.

The field mapping controls the destination.

The public response should not expose the assigned user unless the organization enables that behavior.

## 19. Field Mapping

Incoming fields may map to:

1. A default lead field.
2. A custom lead variable.
3. An ignored field.
4. An unmapped review field.

Each mapping should include:

```text
source_field_name
destination_type
destination_field
data_type
required
default_value
transformation
validation_rule
```

Supported transformations:

1. Trim whitespace.
2. Convert to lowercase.
3. Convert to uppercase.
4. Normalize email.
5. Normalize phone.
6. Parse numbers.
7. Parse currency.
8. Convert values to boolean.
9. Split a full name.
10. Join values.
11. Replace values.
12. Apply a default value.

The mapping tester should display:

1. Original payload.
2. Mapped lead.
3. Validation failures.
4. Unmapped fields.
5. Duplicate result.
6. Selected routing flow.
7. Simulated assignment result.

## 20. Lead Validation

Validation must occur before routing.

Validate:

1. Required fields.
2. Email format.
3. Phone format.
4. Maximum field lengths.
5. Number format.
6. Currency format.
7. Date format.
8. Select option validity.
9. Custom variable validation rules.
10. Source status.
11. Request authentication.
12. Request signature when enabled.

Invalid submissions must be stored in the submission log.

Administrators should be able to:

1. View the original payload.
2. View mapping results.
3. View validation errors.
4. Correct mapped values.
5. Resubmit the lead.
6. Mark the submission as ignored.

## 21. Duplicate Detection

Duplicate checking should use:

1. Idempotency key.
2. External submission identifier.
3. Normalized email.
4. Normalized phone.
5. External CRM record identifier when available.

The duplicate window should be configurable.

Supported actions:

```text
flag_and_continue
send_to_manual_review
update_existing
reject_submission
```

Complex automatic merging is not required.

Every duplicate decision must be recorded in the activity timeline.

## 22. Internal Location Processing

The original submitted location must always be preserved.

The system may internally store:

```text
normalized_address
internal_latitude
internal_longitude
geographic_identifier
normalization_status
normalization_provider
normalization_metadata
```

Internal location information is only for:

1. Territory matching.
2. Radius matching.
3. Address normalization.
4. Ambiguity detection.
5. Routing diagnostics.

Location normalization statuses:

```text
confirmed
partial
ambiguous
invalid
not_provided
```

Ambiguous or invalid locations should enter manual review when no safe fallback exists.

## 23. Service Territories

Territory types:

```text
country
state_province
county
city
neighborhood
postal_code
radius
```

Territory fields:

```text
id
organization_id
name
territory_type
country
state_province
county
city
neighborhood
postal_code
center_geography
radius_distance
priority
status
created_at
updated_at
```

Territories may belong to:

1. A user.
2. A team.
3. Both a user and a team.

Territories should support:

1. Active and inactive status.
2. Priority.
3. User assignment.
4. Team assignment.
5. Bulk import.
6. Date based activation when needed.

Custom map polygon drawing is not included.

## 24. Territory Conflict Detection

The interface must warn administrators when:

1. Two active territories overlap.
2. A territory has no active users.
3. A territory has no active team.
4. A postal code belongs to multiple territories with equal priority.
5. A routing rule references an inactive territory.
6. An area has no configured fallback.
7. A team territory has no eligible users.

Warnings should be divided into:

```text
blocking_error
warning
information
```

## 25. Routing Flows

Routing flow fields:

```text
id
organization_id
name
description
status
default_team_id
default_user_id
acceptance_deadline_minutes
created_at
updated_at
published_at
```

Routing flow statuses:

```text
draft
active
inactive
archived
```

Only published versions may route live leads.

Publishing a routing flow must create an immutable routing flow version.

Each routed lead must retain:

```text
routing_flow_id
routing_flow_version_id
```

Historical routing versions must never change after publication.

## 26. Routing Rules

Routing rule fields:

```text
id
organization_id
routing_flow_version_id
name
priority
match_type
conditions
recipient_requirements
action
stop_processing
created_at
```

Match types:

```text
match_all
match_any
```

Default lead conditions may use:

1. Country.
2. State or province.
3. County.
4. City.
5. Neighborhood.
6. Postal code.
7. Lead source.
8. Campaign.
9. Medium.
10. Referrer.
11. Submission date.
12. Submission time.
13. Day of week.
14. Lead priority.
15. Lead status.

Any active custom lead variable may also be used.

## 27. Condition Operators

### 27.1 Text Operators

```text
equals
not_equals
contains
not_contains
starts_with
ends_with
is_empty
is_not_empty
is_in
is_not_in
```

### 27.2 Number and Currency Operators

```text
equals
not_equals
greater_than
less_than
greater_than_or_equal
less_than_or_equal
is_empty
is_not_empty
```

### 27.3 Date Operators

```text
equals
before
after
on_or_before
on_or_after
is_empty
is_not_empty
```

### 27.4 Boolean Operators

```text
is_true
is_false
```

### 27.5 Geographic Operators

```text
matches_territory
within_radius
```

## 28. Routing Actions

Supported actions:

1. Assign to a specific user.
2. Assign to a team.
3. Assign using round robin.
4. Assign using weighted round robin.
5. Set lead priority.
6. Add a tag.
7. Send to manual review.
8. Use a fallback user.
9. Use a fallback team.
10. Trigger an outbound webhook.

## 29. Assignment Algorithms

### 29.1 Direct Assignment

Assign the lead to a specific eligible user.

### 29.2 Team Round Robin

Select the next eligible user from a team using an atomic rotation state.

### 29.3 Weighted Round Robin

Select users based on assignment weights.

Example:

```text
User A weight 3
User B weight 2
User C weight 1
```

Capacity and availability filters must run before user selection.

### 29.4 Fallback Assignment

When the preferred assignment cannot be completed, the flow may:

1. Assign a fallback user.
2. Assign a fallback team.
3. Send the lead to manual review.

## 30. Transaction Safe Assignment

Critical routing and assignment operations must execute through secure PostgreSQL database functions.

Recommended database functions:

```text
route_lead
accept_assignment
decline_assignment
expire_assignment
reassign_lead
simulate_routing
```

The routing transaction should:

1. Lock the lead routing record.
2. Confirm the lead has no active assignment.
3. Load the published routing version.
4. Evaluate rules in priority order.
5. Generate eligible teams.
6. Generate eligible users.
7. Remove inactive users.
8. Remove unavailable users.
9. Remove users outside working hours.
10. Remove users at daily capacity.
11. Remove users at active capacity.
12. Remove users without territory coverage.
13. Remove users missing recipient attributes.
14. Remove previous decliners.
15. Run the assignment algorithm.
16. Create the assignment.
17. Update lead ownership.
18. Update round robin state atomically.
19. Create the acceptance deadline.
20. Add activity records.
21. Add queue messages.
22. Commit the transaction.

The system must enforce a database constraint preventing more than one active assignment for the same lead.

## 31. Assignment Lifecycle

Assignment statuses:

```text
pending
notified
viewed
accepted
declined
expired
reassigned
cancelled
```

Workflow:

1. The routing engine creates a pending assignment.
2. The notification job sends the assignment notification.
3. The assignment becomes notified.
4. The user views the assignment.
5. The assignment becomes viewed.
6. The user accepts or declines.
7. An accepted assignment confirms ownership.
8. A declined assignment triggers reassignment.
9. An unanswered assignment expires.
10. An expired assignment triggers reassignment.
11. Previous assignment attempts remain visible.
12. Previous recipients are excluded.
13. When all recipients are exhausted, the lead enters manual review.

## 32. Assignment Acceptance

Each routing flow may define an acceptance deadline.

Example:

```text
5 minutes
```

Agents should receive:

1. An email notification.
2. An in application notification.
3. A direct link to the lead.
4. An accept action.
5. A decline action.

Repeated accept or decline requests must be idempotent.

An expired assignment cannot be accepted unless an administrator explicitly restores it.

## 33. Routing Explanation

Every live assignment must store structured reasoning.

Store:

1. Routing flow identifier.
2. Routing version identifier.
3. Rules evaluated.
4. Condition results.
5. Matched rule.
6. Territory matches.
7. Eligible teams.
8. Eligible users.
9. Excluded users.
10. Exclusion reason codes.
11. Assignment algorithm.
12. Selected user.
13. Fallback result.
14. Processing timestamps.

Stable exclusion codes should include:

```text
USER_INACTIVE
USER_UNAVAILABLE
OUTSIDE_WORKING_HOURS
DAILY_CAPACITY_REACHED
ACTIVE_CAPACITY_REACHED
TERRITORY_NOT_MATCHED
RECIPIENT_ATTRIBUTE_NOT_MATCHED
PREVIOUSLY_DECLINED
NOT_IN_SELECTED_TEAM
TEAM_INACTIVE
TERRITORY_INACTIVE
```

The readable explanation must be generated from structured results.

Do not use artificial intelligence to generate routing explanations.

## 34. Routing Simulator

Administrators must be able to test routing without creating a live assignment.

The simulator should display:

1. Mapped lead data.
2. Validation results.
3. Normalized location.
4. Rules evaluated.
5. Conditions passed.
6. Conditions failed.
7. Territories matched.
8. Eligible teams.
9. Eligible users.
10. Excluded users.
11. Exclusion reasons.
12. Assignment algorithm.
13. Expected assigned user.
14. Expected fallback.

The simulator must not:

1. Create a live lead.
2. Create an assignment.
3. Change round robin state.
4. Send notifications.
5. Deliver webhooks.
6. Synchronize a CRM.
7. Change user capacity.
8. Create production activity records.

## 35. Manual Review Queue

Manual review reasons:

```text
no_matching_rule
no_eligible_user
missing_required_data
missing_location
ambiguous_location
invalid_location
duplicate_review
all_users_at_capacity
all_users_unavailable
assignment_attempts_exhausted
manual_request
submission_mapping_error
```

Administrators and permitted managers can:

1. View queue items.
2. Filter by reason.
3. Correct lead information.
4. Add missing custom variables.
5. Select a routing flow.
6. Run the simulator.
7. Rerun live routing.
8. Assign a team.
9. Assign a user.
10. Add a note.
11. Resolve the item.
12. Dismiss the item.

## 36. Basic Lead Interface

The application should provide a lightweight lead management interface.

It must not become a complete CRM.

### 36.1 Lead List

Default columns:

1. Lead name.
2. Email.
3. Phone.
4. Location.
5. Source.
6. Assigned team.
7. Assigned user.
8. Lead status.
9. Assignment status.
10. Priority.
11. Created date.
12. Last activity.

Administrators may add selected custom variables as optional columns.

### 36.2 Lead Filters

1. Date range.
2. Lead status.
3. Assignment status.
4. Team.
5. User.
6. Source.
7. City.
8. State or province.
9. Postal code.
10. Manual review status.
11. Duplicate status.
12. Priority.
13. Custom variable.

### 36.3 Lead Detail

The lead detail page should include:

1. Contact information.
2. Basic location.
3. Message.
4. Source information.
5. Consent information.
6. Custom variables.
7. Assignment status.
8. Assignment explanation.
9. Assignment history.
10. Notes.
11. Activity timeline.
12. Integration status.
13. Duplicate information.
14. Original payload for authorized administrators.

## 37. Lead Statuses

Default lead statuses:

```text
new
assigned
accepted
contact_attempted
contacted
qualified
unqualified
converted
lost
```

Organizations may:

1. Rename statuses.
2. Reorder statuses.
3. Disable statuses.
4. Add custom statuses.

Do not build a visual sales pipeline.

## 38. Notes

Note fields:

```text
id
organization_id
lead_id
author_user_id
content
created_at
updated_at
```

A note is visible to users who have access to the lead.

Private notes are not required.

## 39. Activity Timeline

Activity types should include:

```text
lead_received
lead_mapped
lead_validated
duplicate_detected
location_normalized
routing_started
routing_rule_matched
routing_failed
assignment_created
assignment_notified
assignment_viewed
assignment_accepted
assignment_declined
assignment_expired
lead_reassigned
manual_assignment
manual_reassignment
status_changed
note_added
crm_sync_started
crm_sync_completed
crm_sync_failed
webhook_sent
webhook_failed
manual_review_started
manual_review_resolved
submission_corrected
```

System generated activities cannot be edited.

## 40. Notifications

Phase 1 supports:

1. Email notifications.
2. In application notifications.

Notification events:

1. User invitation.
2. New lead assignment.
3. Assignment approaching expiration.
4. Assignment expired.
5. Lead reassigned.
6. Lead manually assigned.
7. Lead entered manual review.
8. CRM synchronization failed.
9. Webhook delivery exhausted retries.

Notification processing should use Supabase Queues.

Failures must not roll back a successful assignment transaction.

## 41. Background Processing

Use Supabase Queues for:

```text
assignment_notifications
crm_sync
outbound_webhooks
integration_retries
csv_imports
operational_alerts
```

Use Supabase Cron for:

1. Expiring unanswered assignments.
2. Reassigning expired leads.
3. Processing queue messages.
4. Retrying CRM synchronization.
5. Retrying webhook deliveries.
6. Updating routing health metrics.
7. Sending assignment expiration warnings.

Every queue message and scheduled process must be idempotent.

Job statuses:

```text
queued
processing
completed
failed
retrying
cancelled
dead_letter
```

## 42. CRM Integration Architecture

Build a generic CRM adapter interface before provider specific code.

Required methods:

```text
connect
disconnect
test_connection
list_users
create_or_update_contact
assign_owner
update_status
create_note
handle_webhook
refresh_credentials
```

Phase 1 should implement one direct CRM adapter.

The routing platform is the source of truth for:

1. Routing.
2. Assignment history.
3. Acceptance status.
4. Territory logic.
5. Routing explanations.

The external CRM is the source of truth for:

1. Broader sales activity.
2. Existing CRM workflows.
3. Long term contact management.
4. Additional business processes.

CRM synchronization should support:

1. Create or update a contact.
2. Assign the CRM owner.
3. Send source information.
4. Send mapped custom variables.
5. Add the routing explanation as a note.
6. Send accepted assignment status.
7. Receive selected lead status changes.
8. Store the external record identifier.
9. Retry failures.
10. Prevent duplicate CRM contacts.

Do not synchronize:

1. Calls.
2. SMS.
3. Email conversations.
4. Appointments.
5. Historical CRM activity.

## 43. Generic Outbound Webhooks

Supported events:

```text
lead.created
lead.assigned
lead.accepted
lead.declined
lead.reassigned
lead.status_changed
lead.converted
lead.lost
```

Each delivery should include:

1. Unique event identifier.
2. Event type.
3. Organization identifier.
4. Timestamp.
5. Lead information.
6. Custom variables.
7. Assignment information.
8. Signature.

Webhook requirements:

1. Signed payloads.
2. Replay protection.
3. Idempotent delivery.
4. Configurable subscribed events.
5. Retry processing.
6. Delivery logs.
7. Manual retry.
8. Secret rotation support.

Suggested retry schedule:

```text
1 minute
5 minutes
30 minutes
2 hours
12 hours
```

## 44. Integration Logs

Integration log fields:

```text
id
organization_id
provider
event_type
lead_id
request_summary
response_summary
status
attempt_count
next_retry_at
created_at
completed_at
```

Administrators can:

1. Filter integration logs.
2. View safe request details.
3. View safe response details.
4. Retry failed operations.
5. Mark an item resolved.

Credentials, tokens, and private lead information must not appear in integration logs.

## 45. Routing Health Dashboard

The administrator dashboard should show:

1. Leads received today.
2. Successfully assigned leads.
3. Leads awaiting acceptance.
4. Expired assignments.
5. Reassigned leads.
6. Leads in manual review.
7. Leads with no matching rule.
8. Leads with no eligible user.
9. Users at capacity.
10. Unavailable users.
11. Territories without active users.
12. Territory conflicts.
13. CRM synchronization failures.
14. Webhook failures.
15. Median routing time.
16. Median acceptance time.
17. Assignment success rate.
18. Manual routing rate.

Complex revenue attribution is not required.

## 46. Audit Logs

Audit these actions:

1. User invited.
2. User deactivated.
3. User role changed.
4. Team created.
5. Team updated.
6. Territory created.
7. Territory updated.
8. Capacity changed.
9. Availability overridden.
10. Routing flow published.
11. Routing rule changed.
12. Lead manually assigned.
13. Lead manually reassigned.
14. Integration connected.
15. Integration disconnected.
16. Source token created.
17. Source token revoked.
18. Webhook secret rotated.
19. Organization settings changed.
20. Data exported.

Audit fields:

```text
id
organization_id
actor_user_id
action
entity_type
entity_id
before_data
after_data
ip_address
user_agent
created_at
```

Audit records must not be editable by organization users.

## 47. Sentry Error Monitoring

Use the official Sentry SDK for Next.js.

Capture unexpected errors from:

1. Browser components.
2. Server Components.
3. Server Actions.
4. Route handlers.
5. Lead intake processing.
6. Supabase database functions.
7. Routing and assignment operations.
8. Queue processors.
9. Cron processors.
10. CRM adapters.
11. Webhook deliveries.
12. Supabase Edge Functions.

Configure:

```text
sendDefaultPii = false
```

Keep Session Replay disabled during Phase 1.

Create a central `beforeSend` sanitizer.

Remove:

1. Names.
2. Email addresses.
3. Phone numbers.
4. Street addresses.
5. Form messages.
6. Consent text.
7. Original lead payloads.
8. Custom variable values.
9. Cookies.
10. Authorization headers.
11. Access tokens.
12. Refresh tokens.
13. Supabase secret keys.
14. CRM credentials.
15. Sentry authentication tokens.

Allowed diagnostic identifiers include:

```text
organization_id
lead_id
assignment_id
routing_flow_id
routing_flow_version_id
source_id
job_id
integration_provider
environment
release
```

Expected validation errors must not be reported as Sentry exceptions.

## 48. Main Interface Pages

### 48.1 Authentication Pages

1. Login.
2. Invitation acceptance.
3. Password reset.
4. Email verification.

### 48.2 Main Application Pages

1. Dashboard.
2. Leads.
3. Lead detail.
4. Manual review.
5. Notifications.
6. User profile.
7. Availability settings.

### 48.3 Administration Pages

1. Organization settings.
2. Users.
3. Teams.
4. Recipient attributes.
5. Territories.
6. Territory import.
7. Lead sources.
8. Field mappings.
9. Custom lead variables.
10. Routing flows.
11. Routing rules.
12. Routing simulator.
13. CRM integration.
14. Outbound webhooks.
15. Submission logs.
16. Integration logs.
17. Audit logs.
18. Bulk user import.
19. Routing health.

## 49. Suggested Code Structure

```text
src
  app
  components
  modules
    auth
    organizations
    users
    teams
    recipient_attributes
    availability
    territories
    lead_sources
    lead_intake
    field_mapping
    custom_variables
    leads
    duplicate_detection
    routing
    assignments
    manual_review
    notes
    activities
    notifications
    integrations
    webhooks
    routing_health
    audit
    imports
  lib
    supabase
    validation
    permissions
    logging
    sentry
    errors
  types

supabase
  migrations
  functions
  seed.sql

docs
  phase1_product_spec.md
  architecture.md
  database_schema.md
  permissions_matrix.md
  routing_engine.md
  security_model.md
  testing_strategy.md
  implementation_plan.md
  decisions.md
  production_readiness.md
```

Business logic must not be placed directly inside React components.

Critical routing logic must not be spread across multiple browser requests.

## 50. Core Database Tables

Recommended tables:

```text
organizations
organization_users
user_profiles
teams
team_users
user_availability
user_assignment_settings
recipient_attribute_definitions
recipient_attribute_values
territories
territory_users
territory_teams
lead_sources
field_mappings
custom_variable_definitions
leads
lead_custom_values
lead_locations_internal
lead_duplicates
routing_flows
routing_flow_versions
routing_rules
routing_rule_versions
routing_state
assignments
assignment_attempts
lead_status_definitions
lead_status_history
notes
activities
notifications
submission_logs
manual_review_items
integration_connections
integration_field_mappings
external_record_links
integration_jobs
integration_logs
webhook_endpoints
webhook_deliveries
audit_logs
api_tokens
import_jobs
import_rows
routing_health_metrics
```

## 51. Important Database Constraints

Include:

1. Unique custom variable key per organization.
2. Unique recipient attribute key per organization.
3. Unique source token hash.
4. Unique active assignment per lead.
5. Unique idempotency key per source.
6. Unique external submission identifier per source when provided.
7. Unique external CRM record link per provider and organization.
8. Foreign key restrictions preventing cross organization relationships.
9. Immutable published routing versions.
10. Required organization ownership on tenant records.
11. Unique team name where appropriate within an organization.
12. Valid assignment weight values.
13. Valid capacity values.
14. Valid assignment state transitions.

## 52. Security Requirements

Phase 1 must include:

1. Supabase authentication.
2. Email verification.
3. Password reset.
4. Row Level Security.
5. Server side authorization.
6. Tenant isolation.
7. Hashed source tokens.
8. Encrypted CRM credentials.
9. Signed webhook deliveries.
10. Replay protection.
11. Request rate limiting.
12. Zod validation.
13. Safe error responses.
14. Structured security logs.
15. Sentry sanitization.
16. Database backups.
17. Separate development, preview, and production environments.
18. Dependency vulnerability checks.
19. Secret protection.
20. Organization data export.
21. Organization data deletion procedures.
22. Audit history.
23. Least privilege access.
24. No secret keys in browser code.
25. No personal lead data in logs.

## 53. Environment Variables

Expected variables may include:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SENTRY_DSN
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
EMAIL_PROVIDER_API_KEY
EMAIL_FROM_ADDRESS
CRM_CLIENT_ID
CRM_CLIENT_SECRET
CRM_REDIRECT_URI
GEOCODING_PROVIDER_KEY
WEBHOOK_ENCRYPTION_KEY
```

All environment variables must be validated during application startup.

Secrets must not be committed to GitHub.

## 54. Testing Requirements

Use Vitest for unit and integration tests.

Use Playwright before customer pilots.

Required test categories:

1. Authentication.
2. Organization isolation.
3. Row Level Security.
4. Role permissions.
5. User invitations.
6. User deactivation.
7. Team membership.
8. Availability.
9. Capacity.
10. Custom variables.
11. Recipient attributes.
12. Field mapping.
13. Lead intake.
14. Validation.
15. Duplicate detection.
16. Territory matching.
17. Routing rule matching.
18. Direct assignment.
19. Round robin.
20. Weighted round robin.
21. Assignment concurrency.
22. Assignment acceptance.
23. Assignment decline.
24. Assignment expiration.
25. Automatic reassignment.
26. Manual review.
27. Queue idempotency.
28. Cron idempotency.
29. Webhook signatures.
30. Webhook retries.
31. CRM retries.
32. Sentry sanitization.
33. Audit logs.
34. Bulk imports.

Release blocking routing tests include:

1. Concurrent submissions cannot create duplicate active assignments.
2. Concurrent round robin requests cannot corrupt rotation state.
3. Historical routing versions remain unchanged.
4. Routing simulation does not change live data.
5. Cross organization routing data cannot be accessed.
6. Assignment explanations match stored structured results.

## 55. Build Sequence

### Milestone 1: Foundation

Build:

1. Next.js structure.
2. Supabase integration.
3. Authentication.
4. Organizations.
5. Memberships.
6. Roles.
7. Row Level Security.
8. Environment validation.
9. Logging.
10. Error handling.
11. Sentry foundation.
12. Testing foundation.

Definition of done:

1. Users can authenticate.
2. Organization membership works.
3. Tenant isolation tests pass.
4. Role tests pass.
5. No secret keys are exposed.
6. Sentry receives safe test errors.

### Milestone 2: Users and Teams

Build:

1. User invitations.
2. User activation.
3. Teams.
4. Team membership.
5. Availability.
6. Working hours.
7. Capacity.
8. Assignment weights.
9. Recipient attributes.
10. Bulk user import.

Definition of done:

1. Administrators can configure eligible recipients.
2. Agents can update availability.
3. Team permissions work.
4. Imports validate and remain transactional.

### Milestone 3: Lead Intake

Build:

1. Lead sources.
2. Source tokens.
3. Intake endpoints.
4. Idempotency.
5. Field mapping.
6. Custom variables.
7. Validation.
8. Submission logs.
9. Duplicate detection.
10. Failed submission recovery.

Definition of done:

1. Different forms can submit different field names.
2. Fields map into default fields and custom variables.
3. Invalid submissions remain visible.
4. Duplicate requests do not create duplicate leads.
5. Sensitive values do not appear in logs or Sentry.

### Milestone 4: Territories

Build:

1. Location normalization.
2. Territory records.
3. User territory membership.
4. Team territory membership.
5. Postal code import.
6. Radius matching.
7. Territory conflict detection.

Definition of done:

1. Every supported territory type works.
2. Internal coordinates remain hidden.
3. Territory conflicts produce warnings.
4. Cross organization territory access is blocked.

### Milestone 5: Routing Engine

Build:

1. Routing flows.
2. Routing versions.
3. Routing rules.
4. Default field conditions.
5. Custom variable conditions.
6. Recipient attribute requirements.
7. Eligibility filtering.
8. Direct assignment.
9. Round robin.
10. Weighted round robin.
11. Fallback logic.
12. Transaction safe assignment.
13. Routing explanations.
14. Routing simulation.

Definition of done:

1. Published flows route live leads.
2. Assignments are deterministic.
3. Concurrent requests are safe.
4. Historical routing versions remain unchanged.
5. Every assignment has structured reasoning.
6. Simulation does not change live state.

### Milestone 6: Assignment Accountability

Build:

1. Assignment notifications.
2. Viewed tracking.
3. Acceptance.
4. Decline.
5. Expiration.
6. Automatic reassignment.
7. Previous recipient exclusion.
8. Manual review.
9. Assignment history.
10. Supabase Queue processing.
11. Supabase Cron processing.

Definition of done:

1. Agents can accept and decline.
2. Expired assignments are reassigned.
3. Repeated jobs remain idempotent.
4. Previous recipients are excluded.
5. Unresolved leads enter manual review.

### Milestone 7: Lead Interface

Build:

1. Dashboard.
2. Lead list.
3. Lead detail.
4. Filters.
5. Custom variable display.
6. Lead statuses.
7. Notes.
8. Activity timeline.
9. Manual review interface.
10. Routing health dashboard.

Definition of done:

1. Agents only see assigned leads.
2. Managers only see permitted team leads.
3. Administrators see organization leads.
4. Routing and assignment events are visible.
5. The interface remains a lightweight lead view.

### Milestone 8: Integrations

Build:

1. CRM adapter interface.
2. First CRM adapter.
3. Field mapping.
4. Owner synchronization.
5. Status synchronization.
6. Outbound webhooks.
7. Signed delivery.
8. Retry processing.
9. Integration logs.
10. Manual retry.

Definition of done:

1. Leads can be created or updated in the CRM.
2. Assigned ownership is synchronized.
3. Duplicate CRM records are minimized.
4. Webhook signatures verify correctly.
5. Failed operations can be retried safely.

### Milestone 9: Production Readiness

Complete:

1. GitHub Actions.
2. Playwright critical journeys.
3. Security review.
4. Tenant isolation review.
5. Concurrency review.
6. Sentry verification.
7. Backup review.
8. Data export.
9. Data deletion.
10. Deployment documentation.
11. Incident response documentation.
12. Pilot onboarding checklist.

Definition of done:

1. All release blocking tests pass.
2. No unresolved critical security issue remains.
3. Preview deployment works.
4. Sentry receives production style errors without personal information.
5. Database migrations are reviewed.
6. Pilot customers can be onboarded safely.

## 56. Phase 1 Acceptance Criteria

Phase 1 is complete when:

1. An organization administrator can create and manage an organization.
2. An administrator can invite users.
3. Users can belong to teams.
4. Users can define availability.
5. Administrators can configure working hours.
6. Administrators can configure capacity.
7. Administrators can configure assignment weights.
8. Administrators can create recipient attributes.
9. Administrators can import users.
10. Administrators can create lead sources.
11. Leads can enter through API or webhook.
12. Incoming fields can map into default fields.
13. Incoming fields can map into custom variables.
14. Invalid submissions are logged.
15. Failed submissions can be corrected.
16. Duplicate submissions are detected.
17. Leads can route by country.
18. Leads can route by state or province.
19. Leads can route by county.
20. Leads can route by city.
21. Leads can route by neighborhood.
22. Leads can route by postal code.
23. Leads can route by radius.
24. Routing conditions can use custom variables.
25. Eligibility can use recipient attributes.
26. Direct assignment works.
27. Round robin works.
28. Weighted round robin works.
29. Availability filtering works.
30. Working hour filtering works.
31. Capacity filtering works.
32. Territory filtering works.
33. Assignment transactions prevent double ownership.
34. Agents can accept assignments.
35. Agents can decline assignments.
36. Expired assignments are reassigned.
37. Previous recipients are excluded.
38. Failed assignments enter manual review.
39. Every assignment has an explanation.
40. Routing flows retain historical versions.
41. Administrators can simulate routing.
42. Simulation does not change live state.
43. Agents only see assigned leads.
44. Managers only see permitted team leads.
45. Administrators only see organization leads.
46. Lead statuses work.
47. Notes work.
48. Every lead has an activity timeline.
49. Leads synchronize to the connected CRM.
50. CRM ownership synchronizes.
51. Failed integration jobs can be retried.
52. Outbound webhooks are signed.
53. Webhook deliveries are idempotent.
54. Tenant isolation tests pass.
55. Important actions are audited.
56. Routing health problems are visible.
57. Sentry captures unexpected errors.
58. Personal information does not appear in Sentry.
59. GitHub Actions pass.
60. Vercel Preview deployments work.

## 57. Pilot Success Requirements

Before considering Phase 1 commercially validated, obtain:

1. At least five design partner organizations.
2. At least three paying pilot customers.
3. Actual lead source payloads.
4. Actual routing rules.
5. Actual territory data.
6. Actual recipient data.
7. Actual CRM synchronization.
8. Live lead assignment testing.

Target pilot results:

1. At least 95 percent of valid leads automatically assigned.
2. Median routing time below 30 seconds.
3. No duplicate active assignments.
4. No cross organization data exposure.
5. At least 80 percent of assignments accepted within the configured deadline.
6. At least 50 percent reduction in manual routing work.
7. Less than 1 percent unresolved integration failures.
8. Continued payment after the pilot period.

## 58. Permanent Claude Code Rules

Claude Code must follow these rules:

1. Read this specification before major changes.
2. Work on only one milestone at a time.
3. Do not add excluded features.
4. Do not expose Supabase secret keys.
5. Do not trust organization identifiers from the browser.
6. Enable Row Level Security on tenant tables.
7. Scope all tenant data by organization.
8. Keep database changes in SQL migrations.
9. Do not modify production databases directly.
10. Do not deploy production without explicit approval.
11. Do not disable security controls to fix tests.
12. Do not weaken database constraints to make tests pass.
13. Do not bypass failing tests.
14. Do not mark unfinished work as complete.
15. Do not store personal lead data in logs or Sentry.
16. Run formatting, linting, type checking, tests, and builds before declaring a milestone complete.
17. Preserve routing and assignment history.
18. Make every queue processor idempotent.
19. Keep critical assignment operations transactional.
20. Document architectural decisions.

## 59. Claude Code Master Prompt

Build a production ready multi tenant SaaS lead routing platform using `docs/phase1_product_spec.md` as the source of truth.

Use:

```text
Next.js App Router
React
TypeScript strict mode
Supabase PostgreSQL
Supabase Auth
Supabase Row Level Security
Supabase SQL migrations
Supabase database functions
Supabase Queues
Supabase Cron
Supabase PostGIS
Zod
Vitest
Playwright before customer pilots
Sentry
Vercel
GitHub
GitHub Actions
```

Do not add:

```text
Redis
BullMQ
pg_boss
Drizzle
Prisma
Another authentication provider
Another database provider
Calling
SMS
Scheduling
Marketing automation
A complete CRM
A visual sales pipeline
Artificial intelligence routing
Lead auctions
```

The application must focus on:

1. Lead intake.
2. Field mapping.
3. Custom lead variables.
4. Recipient attributes.
5. Territory routing.
6. User eligibility.
7. Transaction safe assignments.
8. Assignment acceptance.
9. Automatic reassignment.
10. Routing explainability.
11. Manual review.
12. Lightweight lead visibility.
13. CRM synchronization.
14. Webhook delivery.
15. Operational health.
16. Tenant isolation.
17. Error monitoring.

First create:

1. `CLAUDE.md`
2. `docs/architecture.md`
3. `docs/database_schema.md`
4. `docs/permissions_matrix.md`
5. `docs/api_specification.md`
6. `docs/background_processing.md`
7. `docs/routing_engine.md`
8. `docs/security_model.md`
9. `docs/testing_strategy.md`
10. `docs/implementation_plan.md`
11. `docs/specification_coverage.md`
12. `docs/decisions.md`
13. `.env.example`

Do not implement the complete application in one pass.

Implement one milestone at a time.

For every milestone:

1. Inspect the existing repository.
2. Read the specification.
3. Verify dependencies.
4. Create database migrations.
5. Implement server logic.
6. Implement interface work.
7. Add authorization.
8. Add Row Level Security.
9. Add audit events.
10. Add tests.
11. Run formatting.
12. Run linting.
13. Run TypeScript checking.
14. Run relevant tests.
15. Run the application build.
16. Update documentation.
17. Stop at the milestone boundary.

Do not claim a milestone is complete unless all required checks pass.
