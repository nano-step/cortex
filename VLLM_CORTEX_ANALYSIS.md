# vLLM → Cortex: Architectural Patterns & Implementation Guide

**Analysis Date**: March 2026  
**vLLM Commit**: cd7643015e583c1e78d437118a6ce8282cb85663  
**Focus**: Extracting 5-10 concrete patterns for Cortex's self-learning AI assistant

---

## EXECUTIVE SUMMARY

vLLM's architecture reveals **5 critical patterns** applicable to Cortex:

1. **Continuous Batching + Scheduler** → Async LLM call orchestration
2. **PagedAttention + KV Cache Management** → Semantic cache design
3. **Request Lifecycle & Status Tracking** → Prompt optimization pipeline
4. **Sampling Parameters Strategy** → Synthetic data generation control
5. **Async Engine Pattern** → Non-blocking inference for auto-training

---

## PATTERN 1: CONTINUOUS BATCHING & SCHEDULER

### vLLM Implementation

**Source**: [vllm/v1/core/sched/scheduler.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/v1/core/sched/scheduler.py#L341-L360)

```python
def schedule(self) -> SchedulerOutput:
    """
    Unified scheduling algorithm (no separate prefill/decode phases).
    
    Key insight: Each request tracks:
    - num_computed_tokens: tokens already processed
    - num_tokens_with_spec: total tokens (prompt + output + speculative)
    
    Scheduler assigns tokens to requests so num_computed_tokens catches up
    to num_tokens_with_spec. This covers:
    - Chunked prefills
    - Prefix caching
    - Speculative decoding
    - Jump decoding (future)
    """
    scheduled_new_reqs: list[Request] = []
    scheduled_resumed_reqs: list[Request] = []
    scheduled_running_reqs: list[Request] = []
    preempted_reqs: list[Request] = []
    
    req_to_new_blocks: dict[str, KVCacheBlocks] = {}
    num_scheduled_tokens: dict[str, int] = {}
    token_budget = self.max_num_scheduled_tokens
    
    # Pause state management for distributed scenarios
    if self._pause_state == PauseState.PAUSED_ALL:
        token_budget = 0
```

### Request Queue Abstraction

**Source**: [vllm/v1/core/sched/request_queue.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/v1/core/sched/request_queue.py)

```python
class RequestQueue(ABC):
    """Abstract base for request scheduling policies."""
    pass

class FCFSRequestQueue(deque[Request], RequestQueue):
    """First-Come-First-Served (default)."""
    pass

class PriorityRequestQueue(RequestQueue):
    """Priority-based scheduling (e.g., for SLA-aware serving)."""
    pass
```

### Cortex Application: Async LLM Call Orchestration

**Pattern**: Use vLLM's scheduler design to manage concurrent LLM calls in Cortex's auto-training pipeline.

```python
# Cortex: Async Request Scheduler for Self-Learning
class CortexScheduler:
    """
    Manages concurrent LLM calls for:
    - Prompt optimization (generate variants)
    - Synthetic data generation (batch requests)
    - Model evaluation (parallel inference)
    """
    
    def __init__(self):
        self.request_queue = PriorityRequestQueue()  # Priority: optimization > generation > eval
        self.token_budget = 8192  # Max tokens per scheduling step
        self.max_batch_size = 32
    
    def schedule_optimization_batch(self, prompts: list[str], variants: int = 3):
        """
        Schedule prompt optimization requests with priority.
        
        vLLM pattern: Assign token budget across requests proportionally.
        """
        for prompt in prompts:
            for i in range(variants):
                req = CortexRequest(
                    prompt_id=f"{prompt}:variant_{i}",
                    prompt=prompt,
                    priority=10,  # High priority for optimization
                    max_tokens=256,
                    task_type="prompt_optimization"
                )
                self.request_queue.append(req)
    
    def schedule_synthetic_data_batch(self, templates: list[str]):
        """
        Schedule synthetic data generation with lower priority.
        
        vLLM pattern: Continuous batching allows interleaving with other tasks.
        """
        for template in templates:
            req = CortexRequest(
                prompt_id=f"synthetic:{template}",
                prompt=template,
                priority=5,  # Lower priority
                max_tokens=512,
                task_type="synthetic_generation"
            )
            self.request_queue.append(req)
    
    def step(self) -> SchedulingOutput:
        """
        Execute one scheduling step (vLLM-inspired).
        
        Returns: Batch of requests to execute, token budget allocation.
        """
        scheduled = []
        token_budget = self.token_budget
        
        while self.request_queue and token_budget > 0:
            req = self.request_queue.popleft()
            tokens_needed = req.max_tokens
            
            if tokens_needed <= token_budget:
                scheduled.append(req)
                token_budget -= tokens_needed
            else:
                # Preempt: put back in queue
                self.request_queue.appendleft(req)
                break
        
        return SchedulingOutput(
            scheduled_requests=scheduled,
            remaining_budget=token_budget
        )
```

**Benefits**:
- ✅ Unified scheduling (no separate phases)
- ✅ Priority-aware request handling
- ✅ Token budget management
- ✅ Preemption support for long-running tasks

---

## PATTERN 2: PAGED ATTENTION & KV CACHE MANAGEMENT

### vLLM Implementation

**Source**: [vllm/v1/attention/ops/paged_attn.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/v1/attention/ops/paged_attn.py)

```python
class PagedAttention:
    """
    Memory-efficient attention using paged KV cache.
    
    Key insight: Treat KV cache like virtual memory:
    - Logical blocks (tokens) → Physical blocks (GPU memory)
    - Enables zero-copy attention over cached K/V blocks
    - Supports prefix caching (reuse common prompt prefixes)
    """
    
    @staticmethod
    def split_kv_cache(
        kv_cache: torch.Tensor,
        num_kv_heads: int,
        head_size: int,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Split KV cache into separate K and V tensors."""
        pass
```

### KV Cache Configuration

**Source**: [vllm/v1/core/kv_cache_utils.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/v1/core/kv_cache_utils.py#L1-L80)

```python
@dataclass
class BlockHash(NewType):
    """Hash of a single KV-cache block for prefix caching."""
    pass

def make_block_hash_with_group_id(
    block_hash: BlockHash, group_id: int
) -> BlockHashWithGroupId:
    """Pack BlockHash + group_id for efficient prefix cache lookup."""
    return BlockHashWithGroupId(block_hash + group_id.to_bytes(4, "big"))
```

### Cortex Application: Semantic Cache Design

**Pattern**: Implement semantic caching for prompt embeddings and intermediate LLM outputs.

```python
# Cortex: Semantic Cache with Prefix Hashing
class SemanticCache:
    """
    Cache LLM outputs using vLLM's prefix caching strategy.
    
    Maps: prompt_hash → cached_kv_blocks → reusable attention states
    """
    
    def __init__(self, block_size: int = 16):
        self.block_size = block_size
        self.cache: dict[BlockHash, CachedBlock] = {}
        self.block_pool = BlockPool(max_blocks=1024)
    
    def hash_prompt_prefix(self, tokens: list[int], group_id: int = 0) -> BlockHash:
        """
        Hash prompt tokens in blocks (vLLM pattern).
        
        Example:
        - Prompt: "You are a helpful assistant. Answer: "
        - Tokens: [1, 2, 3, 4, 5, 6, 7, 8]
        - Blocks: [1,2,3,4] | [5,6,7,8]
        - Hash block 1: sha256([1,2,3,4]) → BlockHash
        """
        block_hashes = []
        for i in range(0, len(tokens), self.block_size):
            block = tokens[i:i+self.block_size]
            block_hash = BlockHash(sha256(block).digest())
            block_hashes.append(block_hash)
        
        return block_hashes[0] if block_hashes else BlockHash(b'')
    
    def get_cached_kv(self, prompt_tokens: list[int]) -> Optional[KVCacheBlock]:
        """
        Retrieve cached KV states for prompt prefix.
        
        vLLM pattern: Zero-copy attention over cached blocks.
        """
        block_hash = self.hash_prompt_prefix(prompt_tokens)
        return self.cache.get(block_hash)
    
    def cache_kv_block(self, tokens: list[int], kv_state: torch.Tensor):
        """
        Store KV cache block for future reuse.
        
        Use case: Cache system prompts, few-shot examples, etc.
        """
        block_hash = self.hash_prompt_prefix(tokens)
        self.cache[block_hash] = CachedBlock(
            tokens=tokens,
            kv_state=kv_state,
            created_at=time.time(),
            access_count=0
        )
    
    def evict_lru(self):
        """LRU eviction when cache is full (vLLM pattern)."""
        if len(self.cache) > self.block_pool.max_blocks:
            lru_hash = min(
                self.cache.items(),
                key=lambda x: x[1].access_count
            )[0]
            del self.cache[lru_hash]
```

**Benefits**:
- ✅ Reuse common prompt prefixes (system prompts, few-shot examples)
- ✅ Zero-copy attention (no data duplication)
- ✅ LRU eviction for memory management
- ✅ Applicable to DSPy bridge (cache compiled programs)

---

## PATTERN 3: REQUEST LIFECYCLE & STATUS TRACKING

### vLLM Implementation

**Source**: [vllm/v1/request.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/v1/request.py#L58-L150)

```python
class RequestStatus(enum.IntEnum):
    WAITING = 0
    WAITING_FOR_FSM = 1  # Waiting for finite-state machine (structured output)
    RUNNING = 2
    PREEMPTED = 3
    FINISHED = 4

class Request:
    def __init__(
        self,
        request_id: str,
        prompt_token_ids: list[int] | None,
        sampling_params: SamplingParams | None,
        pooling_params: PoolingParams | None,
        arrival_time: float | None = None,
        priority: int = 0,
        resumable: bool = False,  # Can be paused/resumed
        block_hasher: Callable[[Request], list[BlockHash]] | None = None,
    ) -> None:
        self.request_id = request_id
        self.status = RequestStatus.WAITING
        self.events: list[EngineCoreEvent] = []
        self.stop_reason: int | str | None = None
        
        # Tracking
        self.num_prompt_tokens = len(prompt_token_ids or [])
        self._output_token_ids: list[int] = []
        self.num_computed_tokens = 0  # Tokens processed so far
        self.num_cached_tokens = -1   # Tokens from prefix cache
        
        # Resumable streaming
        self.resumable = resumable
        self.discard_latest_async_tokens = False
```

### Cortex Application: Prompt Optimization Pipeline

**Pattern**: Track prompt variants through optimization stages using vLLM's request lifecycle.

```python
# Cortex: Prompt Optimization Pipeline
class PromptOptimizationRequest:
    """
    Extends vLLM's Request for prompt optimization tracking.
    
    Lifecycle:
    WAITING → OPTIMIZING → EVALUATING → FINISHED
    """
    
    class Status(enum.IntEnum):
        WAITING = 0
        GENERATING_VARIANTS = 1
        EVALUATING_VARIANTS = 2
        SELECTING_BEST = 3
        FINISHED = 4
    
    def __init__(self, original_prompt: str, num_variants: int = 3):
        self.request_id = f"opt_{uuid.uuid4()}"
        self.original_prompt = original_prompt
        self.num_variants = num_variants
        self.status = self.Status.WAITING
        self.arrival_time = time.time()
        
        # Tracking variants
        self.variants: list[PromptVariant] = []
        self.variant_scores: dict[str, float] = {}
        self.best_variant: Optional[PromptVariant] = None
        
        # Events (vLLM pattern)
        self.events: list[OptimizationEvent] = []
    
    def add_event(self, event_type: str, data: dict):
        """Log optimization events (vLLM pattern)."""
        self.events.append(OptimizationEvent(
            timestamp=time.time(),
            event_type=event_type,
            data=data
        ))
    
    def transition_to(self, new_status: Status):
        """State transition with validation."""
        valid_transitions = {
            self.Status.WAITING: [self.Status.GENERATING_VARIANTS],
            self.Status.GENERATING_VARIANTS: [self.Status.EVALUATING_VARIANTS],
            self.Status.EVALUATING_VARIANTS: [self.Status.SELECTING_BEST],
            self.Status.SELECTING_BEST: [self.Status.FINISHED],
        }
        
        if new_status not in valid_transitions.get(self.status, []):
            raise ValueError(f"Invalid transition: {self.status} → {new_status}")
        
        self.status = new_status
        self.add_event("status_transition", {"new_status": new_status.name})

@dataclass
class PromptVariant:
    """A single prompt variant being optimized."""
    variant_id: str
    text: str
    generated_at: float
    score: Optional[float] = None
    feedback: Optional[str] = None

class OptimizationPipeline:
    """
    Manages prompt optimization using vLLM's request lifecycle.
    """
    
    def __init__(self, llm_engine: AsyncLLM):
        self.llm_engine = llm_engine
        self.requests: dict[str, PromptOptimizationRequest] = {}
    
    async def optimize_prompt(self, prompt: str) -> str:
        """
        Full optimization pipeline:
        1. Generate variants
        2. Evaluate each variant
        3. Select best
        """
        req = PromptOptimizationRequest(prompt, num_variants=3)
        self.requests[req.request_id] = req
        
        # Stage 1: Generate variants
        req.transition_to(req.Status.GENERATING_VARIANTS)
        variants = await self._generate_variants(prompt)
        req.variants = variants
        
        # Stage 2: Evaluate variants
        req.transition_to(req.Status.EVALUATING_VARIANTS)
        scores = await self._evaluate_variants(variants)
        req.variant_scores = scores
        
        # Stage 3: Select best
        req.transition_to(req.Status.SELECTING_BEST)
        best = max(variants, key=lambda v: scores[v.variant_id])
        req.best_variant = best
        
        req.transition_to(req.Status.FINISHED)
        return best.text
    
    async def _generate_variants(self, prompt: str) -> list[PromptVariant]:
        """Generate prompt variants using LLM."""
        variant_prompts = [
            f"Rewrite this prompt to be more specific:\n{prompt}",
            f"Make this prompt more concise:\n{prompt}",
            f"Add examples to this prompt:\n{prompt}",
        ]
        
        outputs = await self.llm_engine.generate(
            variant_prompts,
            sampling_params=SamplingParams(
                temperature=0.7,
                max_tokens=256,
                top_p=0.9
            )
        )
        
        return [
            PromptVariant(
                variant_id=f"var_{i}",
                text=output.outputs[0].text,
                generated_at=time.time()
            )
            for i, output in enumerate(outputs)
        ]
    
    async def _evaluate_variants(self, variants: list[PromptVariant]) -> dict[str, float]:
        """Evaluate variants using a scoring LLM."""
        eval_prompts = [
            f"Rate this prompt quality (1-10):\n{v.text}"
            for v in variants
        ]
        
        scores_output = await self.llm_engine.generate(
            eval_prompts,
            sampling_params=SamplingParams(temperature=0.0, max_tokens=10)
        )
        
        return {
            v.variant_id: float(output.outputs[0].text.strip())
            for v, output in zip(variants, scores_output)
        }
```

**Benefits**:
- ✅ Clear state machine for optimization pipeline
- ✅ Event logging for debugging/analysis
- ✅ Resumable requests (pause/resume optimization)
- ✅ Integrates with vLLM's request tracking

---

## PATTERN 4: SAMPLING PARAMETERS STRATEGY

### vLLM Implementation

**Source**: [vllm/sampling_params.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/sampling_params.py#L150-L250)

```python
@dataclass
class SamplingParams(PydanticMsgspecMixin, msgspec.Struct):
    """Sampling parameters for text generation."""
    
    # Temperature: controls randomness
    temperature: float = 1.0
    """Temperature for sampling. Higher = more random."""
    
    # Top-p (nucleus sampling)
    top_p: float = 1.0
    """Cumulative probability for nucleus sampling."""
    
    # Top-k
    top_k: int = -1
    """Number of highest probability tokens to keep."""
    
    # Penalties
    presence_penalty: float = 0.0
    """Penalize new tokens based on appearance in generated text."""
    
    frequency_penalty: float = 0.0
    """Penalize tokens based on frequency in generated text."""
    
    # Output control
    max_tokens: int | None = None
    """Maximum tokens to generate."""
    
    # Structured outputs
    structured_output: StructuredOutputsParams | None = None
    """Constrain output to JSON/regex/grammar."""
```

### Cortex Application: Synthetic Data Generation Control

**Pattern**: Use sampling parameters to control diversity/quality tradeoff in synthetic data generation.

```python
# Cortex: Synthetic Data Generation with Sampling Control
class SyntheticDataGenerator:
    """
    Generate synthetic training data using vLLM's sampling parameters.
    
    Strategies:
    - High temperature: Diverse, creative examples
    - Low temperature: Consistent, high-quality examples
    - Structured output: Enforce JSON/CSV format
    """
    
    def __init__(self, llm_engine: AsyncLLM):
        self.llm_engine = llm_engine
    
    async def generate_diverse_examples(
        self,
        template: str,
        num_examples: int = 10,
        diversity_level: float = 0.8  # 0.0 = deterministic, 1.0 = max random
    ) -> list[str]:
        """
        Generate diverse synthetic examples.
        
        vLLM pattern: High temperature + top_p for diversity.
        """
        # Map diversity_level to temperature
        temperature = 0.3 + (diversity_level * 1.7)  # Range: 0.3 - 2.0
        
        prompts = [template] * num_examples
        
        outputs = await self.llm_engine.generate(
            prompts,
            sampling_params=SamplingParams(
                temperature=temperature,
                top_p=0.95,
                max_tokens=256,
                presence_penalty=0.1,  # Discourage repetition
                frequency_penalty=0.1
            )
        )
        
        return [output.outputs[0].text for output in outputs]
    
    async def generate_consistent_examples(
        self,
        template: str,
        num_examples: int = 10
    ) -> list[str]:
        """
        Generate consistent, high-quality examples.
        
        vLLM pattern: Low temperature for deterministic output.
        """
        prompts = [template] * num_examples
        
        outputs = await self.llm_engine.generate(
            prompts,
            sampling_params=SamplingParams(
                temperature=0.1,  # Near-deterministic
                top_p=0.9,
                max_tokens=256,
                presence_penalty=0.0,
                frequency_penalty=0.0
            )
        )
        
        return [output.outputs[0].text for output in outputs]
    
    async def generate_structured_data(
        self,
        template: str,
        output_schema: dict,
        num_examples: int = 10
    ) -> list[dict]:
        """
        Generate structured data (JSON) using vLLM's structured output.
        
        vLLM pattern: Use StructuredOutputsParams to enforce format.
        """
        prompts = [template] * num_examples
        
        # Convert schema to JSON schema string
        json_schema = json.dumps(output_schema)
        
        outputs = await self.llm_engine.generate(
            prompts,
            sampling_params=SamplingParams(
                temperature=0.5,
                max_tokens=512,
                structured_output=StructuredOutputsParams(
                    json=json_schema
                )
            )
        )
        
        return [
            json.loads(output.outputs[0].text)
            for output in outputs
        ]
    
    async def generate_with_constraints(
        self,
        template: str,
        constraints: dict,  # e.g., {"max_length": 100, "keywords": ["AI", "learning"]}
        num_examples: int = 10
    ) -> list[str]:
        """
        Generate examples with custom constraints.
        
        vLLM pattern: Use logits processors for fine-grained control.
        """
        prompts = [
            f"{template}\n\nConstraints: {json.dumps(constraints)}"
            for _ in range(num_examples)
        ]
        
        outputs = await self.llm_engine.generate(
            prompts,
            sampling_params=SamplingParams(
                temperature=0.7,
                max_tokens=256,
                top_p=0.9
            )
        )
        
        # Post-process to enforce constraints
        results = []
        for output in outputs:
            text = output.outputs[0].text
            if len(text) <= constraints.get("max_length", float('inf')):
                results.append(text)
        
        return results
```

**Benefits**:
- ✅ Fine-grained control over generation diversity
- ✅ Structured output enforcement (JSON/CSV)
- ✅ Penalty-based diversity control
- ✅ Applicable to DSPy synthetic data generation

---

## PATTERN 5: ASYNC ENGINE PATTERN

### vLLM Implementation

**Source**: [vllm/v1/engine/async_llm.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/v1/engine/async_llm.py#L71-L120)

```python
class AsyncLLM(EngineClient):
    """Asynchronous wrapper for vLLM engine."""
    
    def __init__(
        self,
        vllm_config: VllmConfig,
        executor_class: type[Executor],
        log_stats: bool,
        usage_context: UsageContext = UsageContext.ENGINE_CONTEXT,
        start_engine_loop: bool = True,
        stat_loggers: list[StatLoggerFactory] | None = None,
    ) -> None:
        """
        Create an AsyncLLM.
        
        Key features:
        - Background asyncio loop for continuous request processing
        - Non-blocking generate() method
        - Streaming output support
        - Multi-client support (data parallelism)
        """
        self.vllm_config = vllm_config
        self.model_config = vllm_config.model_config
        
        # Engine core client (communicates with inference engine)
        self.engine_core_client = EngineCoreClient(...)
        
        # Input/output processors
        self.input_processor = InputProcessor(...)
        self.output_processor = OutputProcessor(...)
        
        # Background loop
        if start_engine_loop:
            self._start_engine_loop()
```

### Cortex Application: Non-Blocking Auto-Training

**Pattern**: Use AsyncLLM to run auto-training workflows without blocking main inference.

```python
# Cortex: Non-Blocking Auto-Training Engine
class CortexAutoTrainer:
    """
    Runs auto-training workflows asynchronously using vLLM's AsyncLLM.
    
    Workflows:
    - Prompt optimization (background)
    - Synthetic data generation (background)
    - Model evaluation (background)
    - Continuous learning (background)
    """
    
    def __init__(self, llm_engine: AsyncLLM):
        self.llm_engine = llm_engine
        self.training_queue: asyncio.Queue = asyncio.Queue()
        self.results: dict[str, TrainingResult] = {}
    
    async def start_auto_training_loop(self):
        """
        Background loop for auto-training (vLLM pattern: background asyncio loop).
        """
        while True:
            try:
                # Get next training task
                task = await asyncio.wait_for(
                    self.training_queue.get(),
                    timeout=1.0
                )
                
                # Execute training task
                result = await self._execute_training_task(task)
                self.results[task.task_id] = result
                
            except asyncio.TimeoutError:
                # No tasks, continue
                continue
            except Exception as e:
                logger.error(f"Training task failed: {e}")
    
    async def _execute_training_task(self, task: TrainingTask) -> TrainingResult:
        """Execute a single training task."""
        if task.task_type == "prompt_optimization":
            return await self._optimize_prompt(task)
        elif task.task_type == "synthetic_generation":
            return await self._generate_synthetic_data(task)
        elif task.task_type == "model_evaluation":
            return await self._evaluate_model(task)
        else:
            raise ValueError(f"Unknown task type: {task.task_type}")
    
    async def _optimize_prompt(self, task: TrainingTask) -> TrainingResult:
        """Optimize a prompt (non-blocking)."""
        original_prompt = task.data["prompt"]
        
        # Generate variants
        variant_prompts = [
            f"Rewrite this prompt to be more specific:\n{original_prompt}",
            f"Make this prompt more concise:\n{original_prompt}",
            f"Add examples to this prompt:\n{original_prompt}",
        ]
        
        # Non-blocking generate (vLLM pattern)
        outputs = await self.llm_engine.generate(
            variant_prompts,
            sampling_params=SamplingParams(
                temperature=0.7,
                max_tokens=256
            )
        )
        
        # Evaluate variants
        variants = [output.outputs[0].text for output in outputs]
        scores = await self._score_variants(variants)
        
        best_variant = max(zip(variants, scores), key=lambda x: x[1])[0]
        
        return TrainingResult(
            task_id=task.task_id,
            task_type="prompt_optimization",
            original=original_prompt,
            optimized=best_variant,
            improvement=max(scores) - min(scores),
            timestamp=time.time()
        )
    
    async def _generate_synthetic_data(self, task: TrainingTask) -> TrainingResult:
        """Generate synthetic training data (non-blocking)."""
        template = task.data["template"]
        num_examples = task.data.get("num_examples", 10)
        
        # Generate examples
        prompts = [template] * num_examples
        outputs = await self.llm_engine.generate(
            prompts,
            sampling_params=SamplingParams(
                temperature=0.8,
                max_tokens=256,
                top_p=0.95
            )
        )
        
        examples = [output.outputs[0].text for output in outputs]
        
        return TrainingResult(
            task_id=task.task_id,
            task_type="synthetic_generation",
            num_examples=len(examples),
            examples=examples,
            timestamp=time.time()
        )
    
    async def _evaluate_model(self, task: TrainingTask) -> TrainingResult:
        """Evaluate model on benchmark (non-blocking)."""
        test_cases = task.data["test_cases"]
        
        # Batch evaluate
        outputs = await self.llm_engine.generate(
            [tc["prompt"] for tc in test_cases],
            sampling_params=SamplingParams(
                temperature=0.0,
                max_tokens=256
            )
        )
        
        # Score outputs
        scores = []
        for output, test_case in zip(outputs, test_cases):
            score = self._score_output(
                output.outputs[0].text,
                test_case["expected"]
            )
            scores.append(score)
        
        return TrainingResult(
            task_id=task.task_id,
            task_type="model_evaluation",
            avg_score=sum(scores) / len(scores),
            scores=scores,
            timestamp=time.time()
        )
    
    async def _score_variants(self, variants: list[str]) -> list[float]:
        """Score prompt variants using LLM."""
        eval_prompts = [
            f"Rate this prompt quality (1-10):\n{v}"
            for v in variants
        ]
        
        outputs = await self.llm_engine.generate(
            eval_prompts,
            sampling_params=SamplingParams(temperature=0.0, max_tokens=10)
        )
        
        return [
            float(output.outputs[0].text.strip())
            for output in outputs
        ]
    
    def _score_output(self, output: str, expected: str) -> float:
        """Simple scoring (can be replaced with more sophisticated metrics)."""
        # Placeholder: use BLEU, ROUGE, or semantic similarity
        return 0.5  # TODO: implement proper scoring
    
    async def submit_training_task(self, task: TrainingTask):
        """Submit a training task (non-blocking)."""
        await self.training_queue.put(task)
    
    async def get_result(self, task_id: str, timeout: float = 30.0) -> TrainingResult:
        """Wait for training result (non-blocking)."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            if task_id in self.results:
                return self.results.pop(task_id)
            await asyncio.sleep(0.1)
        
        raise TimeoutError(f"Training task {task_id} did not complete within {timeout}s")

@dataclass
class TrainingTask:
    """A single auto-training task."""
    task_id: str
    task_type: str  # "prompt_optimization", "synthetic_generation", "model_evaluation"
    data: dict
    priority: int = 0
    created_at: float = field(default_factory=time.time)

@dataclass
class TrainingResult:
    """Result of a training task."""
    task_id: str
    task_type: str
    timestamp: float
    # Task-specific fields populated as needed
    original: Optional[str] = None
    optimized: Optional[str] = None
    improvement: Optional[float] = None
    num_examples: Optional[int] = None
    examples: Optional[list[str]] = None
    avg_score: Optional[float] = None
    scores: Optional[list[float]] = None
```

**Benefits**:
- ✅ Non-blocking auto-training (doesn't interfere with main inference)
- ✅ Background task queue (vLLM pattern)
- ✅ Async/await for clean concurrency
- ✅ Scalable to multiple training tasks

---

## PATTERN 6: MODEL LOADING & WEIGHT MANAGEMENT

### vLLM Implementation

**Source**: [vllm/v1/engine/llm_engine.py](https://github.com/vllm-project/vllm/blob/cd7643015e583c1e78d437118a6ce8282cb85663/vllm/v1/engine/llm_engine.py#L48-L80)

```python
class LLMEngine:
    """Core LLM inference engine."""
    
    def __init__(
        self,
        vllm_config: VllmConfig,
        executor_class: type[Executor],
        log_stats: bool,
    ) -> None:
        self.vllm_config = vllm_config
        self.model_config = vllm_config.model_config
        
        # Executor handles model loading and execution
        self.executor = executor_class(vllm_config)
        
        # Scheduler manages request batching
        self.scheduler = Scheduler(vllm_config)
```

### Cortex Application: Multi-Model Routing

**Pattern**: Use vLLM's model loading to support multiple models for different tasks.

```python
# Cortex: Multi-Model Router
class CortexModelRouter:
    """
    Route requests to different models based on task type.
    
    Models:
    - Base model: General-purpose inference
    - Optimization model: Prompt optimization
    - Evaluation model: Quality assessment
    - Synthetic model: Data generation
    """
    
    def __init__(self):
        self.models: dict[str, AsyncLLM] = {}
        self.model_configs: dict[str, VllmConfig] = {}
    
    async def load_model(self, model_name: str, model_path: str):
        """Load a model using vLLM's engine."""
        vllm_config = VllmConfig(
            model_config=ModelConfig(model_path),
            cache_config=CacheConfig(block_size=16),
            parallel_config=ParallelConfig(tensor_parallel_size=1),
        )
        
        llm = AsyncLLM(
            vllm_config=vllm_config,
            executor_class=MultiprocExecutor,
            log_stats=True
        )
        
        self.models[model_name] = llm
        self.model_configs[model_name] = vllm_config
    
    async def route_request(
        self,
        prompt: str,
        task_type: str,
        sampling_params: SamplingParams
    ) -> str:
        """Route request to appropriate model."""
        model_name = self._select_model(task_type)
        llm = self.models[model_name]
        
        outputs = await llm.generate(
            [prompt],
            sampling_params=sampling_params
        )
        
        return outputs[0].outputs[0].text
    
    def _select_model(self, task_type: str) -> str:
        """Select model based on task type."""
        routing_table = {
            "prompt_optimization": "optimization_model",
            "synthetic_generation": "synthetic_model",
            "model_evaluation": "evaluation_model",
            "general_inference": "base_model",
        }
        
        return routing_table.get(task_type, "base_model")
```

---

## SUMMARY: 5-10 CONCRETE PATTERNS FOR CORTEX

| # | Pattern | vLLM Source | Cortex Application | Status |
|---|---------|-------------|-------------------|--------|
| 1 | **Continuous Batching + Scheduler** | `scheduler.py` | Async LLM call orchestration | ✅ Ready |
| 2 | **PagedAttention + KV Cache** | `paged_attn.py` | Semantic cache design | ✅ Ready |
| 3 | **Request Lifecycle** | `request.py` | Prompt optimization pipeline | ✅ Ready |
| 4 | **Sampling Parameters** | `sampling_params.py` | Synthetic data generation | ✅ Ready |
| 5 | **Async Engine** | `async_llm.py` | Non-blocking auto-training | ✅ Ready |
| 6 | **Model Loading** | `llm_engine.py` | Multi-model routing | ✅ Ready |
| 7 | **Prefix Caching** | `kv_cache_utils.py` | DSPy program caching | 🔄 Planned |
| 8 | **Speculative Decoding** | `spec_decode/` | Faster inference | 🔄 Planned |
| 9 | **Structured Output** | `sampling_params.py` | JSON/CSV generation | ✅ Ready |
| 10 | **Distributed Scheduling** | `scheduler.py` | Multi-GPU auto-training | 🔄 Planned |

---

## IMPLEMENTATION ROADMAP

### Phase 1: Core Patterns (Weeks 1-2)
- [ ] Implement `CortexScheduler` (Pattern 1)
- [ ] Implement `SemanticCache` (Pattern 2)
- [ ] Implement `PromptOptimizationRequest` (Pattern 3)

### Phase 2: Auto-Training (Weeks 3-4)
- [ ] Implement `SyntheticDataGenerator` (Pattern 4)
- [ ] Implement `CortexAutoTrainer` (Pattern 5)
- [ ] Integrate with DSPy bridge

### Phase 3: Advanced Features (Weeks 5-6)
- [ ] Implement `CortexModelRouter` (Pattern 6)
- [ ] Add prefix caching for DSPy programs (Pattern 7)
- [ ] Add speculative decoding (Pattern 8)

---

## REFERENCES

- **vLLM Paper**: [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)
- **vLLM Docs**: https://docs.vllm.ai/
- **vLLM GitHub**: https://github.com/vllm-project/vllm
- **Commit**: cd7643015e583c1e78d437118a6ce8282cb85663

