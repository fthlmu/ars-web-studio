// P9: Stage 1 (Research) handoff error type.
//
// Think of each deep-research agent as a stage in a signal chain. Each stage
// must hand the next one a complete, well-formed packet (a JSON object with
// every required field). If a field is missing or malformed, the packet is
// corrupt and the pipeline must STOP rather than pass garbage downstream.
//
// HandoffIncompleteError carries which schema failed (schema1/2/3) and the exact
// list of field names that were missing or invalid, so the UI can tell the user
// precisely what went wrong.
export class HandoffIncompleteError extends Error {
  constructor(public schemaId: string, public missingFields: string[]) {
    super('HANDOFF_INCOMPLETE [' + schemaId + ']: missing or invalid fields: ' + missingFields.join(', '))
    this.name = 'HandoffIncompleteError'
  }
}
