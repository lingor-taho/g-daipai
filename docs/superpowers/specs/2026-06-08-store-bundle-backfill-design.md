# Store Bundle Backfill Design

## Goal

Add a hidden admin-only backfill action for store orders that have already been manually bundled and paid on Yahoo. The system does not automate Yahoo store bundle operations. This action only aligns local order state with the already-completed Yahoo operation.

## Entry Point

- Admin order list: double-click the `订单状态` cell.
- Only store orders should open the modal.
- Modal title: `商城同捆已付款补录`.
- Fields:
  - Main product ID, defaulted from the double-clicked row.
  - Child product IDs, separated by half-width or full-width commas.
  - Bundle shipping fee, integer JPY amount.

## Status Result

- Main product:
  - `order_status = pending_shipment`
  - `bundle_shipping_fee_text = "<amount>円"`
- Child products:
  - `order_status = bundle_completed`
  - `bundle_shipping_fee_text = "0円"`
- All products:
  - Same new `bundle_group_id`.

## Validation

- Main and child product IDs are required.
- Child product IDs accept `,` and `，`.
- Main product cannot be listed as a child.
- All product IDs must exist in successful orders.
- All products must be store products.
- Products from different users are allowed.
- Reject orders already in `completed`, `cancelled`, or `pending_receipt`.
- Existing bundle groups may be overwritten because the action is an admin correction tool.

## Audit

- Write order status logs with source `admin_store_bundle_backfill`.
- Metadata includes main product ID, child product IDs, bundle shipping fee, and generated bundle group ID.

## Flow Fit

After backfill, the main order continues with existing `pending_shipment -> pending_receipt -> completed` scanning/receipt flow. Child orders stay `bundle_completed` until the main order's receipt confirmation completes the bundle group.
