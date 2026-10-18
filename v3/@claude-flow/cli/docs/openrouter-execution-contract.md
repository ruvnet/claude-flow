# OpenRouter execution repair

Standalone three-file candidate against upstream b93144803bb171b12993b715fe7b2dd936b6edd5. No Ollama-cloud prerequisite or optional model-permission feature is included.

Normalize versioned/unversioned OpenAI-compatible roots; preserve configured tier/default and exact native IDs; capture OpenRouter provider/endpoint/key for one execution including retries. Environment values retain existing precedence. Save actual failed results instead of stale successes. Persist only fixed error messages/validated HTTP status in final errors and fallback histories, retaining direct response details.

Existing Anthropic/Ollama first-call selection, transport functions and provider unions are preserved. Explicit provider selection is now also forwarded on retries. No credential rotation, mandatory policy layer, global config change, installation or real-provider acceptance is claimed.
