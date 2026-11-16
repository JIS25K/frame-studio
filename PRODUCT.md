# FRAME Studio

<!-- impeccable:product-schema 1 -->

## Platform
web, mobile camera capture and desktop/mobile creative planning.

## Users and purpose
Korean product sellers capture the actual product, then turn a short description of the desired feeling into concrete advertising shot plans. Minimize repeated uploads and unnecessary questions. Preserve original product identity separately from proposed staging.

## Primary flow
Capture a product for up to 90 seconds, inspect selected frames and unresolved gaps, then continue to planning with those photos already attached. Enter only the desired scene or feeling. Direct uploads and the virtual cosmetic example remain independent entry paths. Choose an AI direction, revise individual fields, approve and export a production package. No final image generation is implemented.

## Truth and constraints
Capture selection and supplemental checks are model estimates, not certified coverage or 3D reconstruction. Photos remain in the browser until AI analysis is requested; sampled capture frames and planning inputs go to OpenAI. Full video stays local. Failed local persistence must not navigate away from captured photos. Existing plans must not be silently replaced. Product evidence must remain distinguishable from staging references. No customer CS data or secrets belong in the public repository or app assets.

## Current request
Refine the demonstration app: remove non-instructional and repetitive UI copy, preserve the light neutral and blue tone of Thermit/Creazy without exact color copying. Keep capture, direct upload, automatic photo transfer and planning behavior. Performance evaluation is a later task; this pass is UI only.

## Design use scene
Operate mode. A seller handles a phone beside their product under ordinary office/daylight, then reviews photos and builds an advertising scene at a desk. Camera guidance must stay legible and controls easy to touch; photo evidence should dominate over form decoration. Shared navigation, typography, controls and feedback across both routes. Synthetic photography is clearly identified as an example, never as the user's generated result.
