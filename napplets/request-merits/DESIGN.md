# Request Merits design

- Deployment/d-tag: `request-merits`
- One job: validate, preview, and publish kind `1409` merit requests
- Required shell domains: `outbox`, `inc`, and `resource`; optional enhancement: `theme`
- Shell owns requester identity, signing, relay routing, and publication
- Large layout pairs work-claim form with event guide; tiny layout stacks guide and fields
- Pointer and Enter activation both reach review; publish needs separate explicit confirmation
- NOSTROCKET is the confirmed default; selector lists current kind `31108` events from OUTBOX and uses each event author's kind-zero profile avatar
- Work value is mandatory sats; event derives requested merits 1:1 from that value
- No direct network, persistence, relay escape hatch, backend, or external asset
