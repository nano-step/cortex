# Auto-Scan Mode: Production-Quality Patterns for Codebase-Specific Instruction Generation

**Date**: March 25, 2026  
**Research Focus**: Self-Instruct, Evol-Instruct, Magpie, GLAN, LLM-as-Judge patterns for domain-specific synthetic data generation

---

## 1. SELF-INSTRUCT: Core Framework

### 1.1 Pipeline Overview
**Source**: https://github.com/yizhongw/self-instruct

Self-Instruct is an iterative bootstrapping algorithm:
1. Start with **seed set** of manually-written instructions (175 tasks in original paper)
2. Prompt LLM to generate **new instructions** from seed tasks
3. Generate **input-output instances** for each instruction
4. **Filter** low-quality/duplicate instructions (ROUGE-based similarity)
5. Add filtered results back to task pool
6. **Repeat** multiple iterations

**Key Metrics**:
- Original dataset: 52K instructions + 82K instances
- Quality analysis: 46% of data had issues (human evaluation on 200 samples)
- Filtering is critical: removes instructions with keywords like "image", "graph", "file", "draw"

### 1.2 Instruction Generation Prompt Template

```python
def encode_prompt(prompt_instructions, classification=False):
    """Encode multiple prompt instructions into a single string."""
    if classification:
        prompt = "Come up with a series of classification tasks. Try to specify the possible output labels when possible.\n"
    else:
        prompt = "Come up with a series of tasks:\n"
    for idx, instruction in enumerate(prompt_instructions):
        instruction = re.sub(r"\s+", " ", instruction).strip().rstrip(":")
        prompt += f"{idx+1}. {instruction}\n"
    prompt += f"{len(prompt_instructions) + 1}."
    return prompt
```

### 1.3 Post-Processing & Filtering Rules

```python
def post_process_gpt3_response(response):
    # Filter by length: 3 < words < 150
    if len(inst.split()) <= 3 or len(inst.split()) > 150:
        continue
    
    # Filter keywords unsuitable for LLMs
    if any(find_word_in_string(word, inst) for word in 
           ["image", "images", "graph", "graphs", "picture", "pictures", 
            "file", "files", "map", "maps", "draw", "plot", "go to"]):
        continue
    
    # Filter "Write a program" prefix (ambiguous)
    if inst.startswith("Write a program"):
        continue
    
    # Filter punctuation/non-ASCII starts
    if inst[0] in string.punctuation or not inst[0].isascii():
        continue
```

### 1.4 JSONL Training Data Format (OpenAI Fine-tuning)

```json
{"prompt": "Make a list of 10 ways to help students improve their study skills.\n\nOutput:", "completion": " 1. Make a schedule for studying and stick to it.\n2. Study in the same place every time.\n3. Set goals for yourself.\n4. Take breaks when you need them.\n5. Don't cram before an exam.\n6. Get enough sleep.\n7. Eat healthy food.\n8. Exercise regularly.\n9. Find a study partner.\n10. Reward yourself after completing a task.<|endoftext|>"}

{"prompt": "Given a list of numbers, find out if they are prime or not. you can answer \"prime\" or \"not prime\".\n\nInput: List: 1, 4, 6, 8, 9\n\nOutput:", "completion": " not prime<|endoftext|>"}
```

---

## 2. EVOL-INSTRUCT: Complexity-Driven Evolution

### 2.1 WizardLM Approach
**Source**: https://github.com/nlpxucan/WizardLM  
**Paper**: https://arxiv.org/abs/2304.12244

Evol-Instruct evolves instructions through **6 mutation operations**:

#### In-Depth Evolving (5 operations):
1. **Add Constraints**: Add requirements/restrictions
2. **Deepen**: Increase depth/breadth of inquiry
3. **Concretize**: Replace general concepts with specific ones
4. **Increase Reasoning Steps**: Require multi-step thinking
5. **Complicate Input**: Add complex input formats (code, tables, formulas)

#### In-Breadth Evolving (1 operation):
6. **Mutation**: Generate completely new instruction based on given one

### 2.2 Evol-Instruct Prompt Templates

**Base Instruction Template**:
```python
base_instruction = """I want you act as a Prompt Rewriter.
Your objective is to rewrite a given prompt into a more complex version 
to make those famous AI systems (e.g., chatgpt and GPT4) a bit harder to handle.
But the rewritten prompt must be reasonable and must be understood and responded by humans.
Your rewriting cannot omit the non-text parts such as the table and code in #The Given Prompt#:. 
Also, please do not omit the input in #The Given Prompt#.
You SHOULD complicate the given prompt using the following method: 
{}
You should try your best not to make the #Rewritten Prompt# become verbose, 
#Rewritten Prompt# can only add 10 to 20 words into #The Given Prompt#.
'#The Given Prompt#', '#Rewritten Prompt#', 'given prompt' and 'rewritten prompt' 
are not allowed to appear in #Rewritten Prompt#
"""

def createConstraintsPrompt(instruction):
    prompt = base_instruction.format(
        "Please add one more constraints/requirements into #The Given Prompt#'"
    )
    prompt += "#The Given Prompt#: \r\n {} \r\n".format(instruction)
    prompt += "#Rewritten Prompt#:\r\n"
    return prompt

def createDeepenPrompt(instruction):
    prompt = base_instruction.format(
        "If #The Given Prompt# contains inquiries about certain issues, "
        "the depth and breadth of the inquiry can be increased."
    )
    prompt += "#The Given Prompt#: \r\n {} \r\n".format(instruction)
    prompt += "#Rewritten Prompt#:\r\n"
    return prompt

def createConcretizingPrompt(instruction):
    prompt = base_instruction.format(
        "Please replace general concepts with more specific concepts."
    )
    prompt += "#The Given Prompt#: \r\n {} \r\n".format(instruction)
    prompt += "#Rewritten Prompt#:\r\n"
    return prompt

def createReasoningPrompt(instruction):
    prompt = base_instruction.format(
        "If #The Given Prompt# can be solved with just a few simple thinking processes, "
        "you can rewrite it to explicitly request multiple-step reasoning."
    )
    prompt += "#The Given Prompt#: \r\n {} \r\n".format(instruction)
    prompt += "#Rewritten Prompt#:\r\n"
    return prompt
```

### 2.3 Evol-Instruct Pipeline

```python
import json
import random
from openai_access import call_chatgpt
from depth import createConstraintsPrompt, createDeepenPrompt, ...
from breadth import createBreadthPrompt

# Load seed instructions
all_objs = json.load(open('alpaca_data_cleaned.json','r'))
evol_objs = []

for cur_obj in all_objs:
    instruction = cur_obj['instruction'].strip() + '\r\n' + cur_obj['input'].strip()
    
    # Create 6 evolution prompts
    evol_prompts = [
        createConstraintsPrompt(instruction),
        createDeepenPrompt(instruction),
        createConcretizingPrompt(instruction),
        createReasoningPrompt(instruction),
        createBreadthPrompt(instruction),
    ]
    
    # Randomly select one evolution strategy
    selected_evol_prompt = random.choice(evol_prompts)
    
    # Generate evolved instruction
    evol_instruction = call_chatgpt(selected_evol_prompt)
    
    # Generate answer for evolved instruction
    answer = call_chatgpt(evol_instruction)
    
    evol_objs.append({
        "instruction": evol_instruction,
        "output": answer
    })

# Save evolved dataset
with open('alpaca_data_evol.json', 'w') as f:
    json.dump(evol_objs, f, indent=4)
```

### 2.4 Results
- **WizardLM-70B**: 7.78 MT-Bench, 92.91% AlpacaEval
- **WizardCoder-33B**: 79.9 HumanEval pass@1 (surpasses ChatGPT 3.5)
- **WizardMath-7B**: 83.2 GSM8K (outperforms ChatGPT 3.5)

---

## 3. GLAN: Taxonomy-Driven Generation (No Seed Data Required)

### 3.1 Overview
**Source**: https://github.com/Azure/synthetic-qa-generation/tree/main/glan-instruct  
**Paper**: https://arxiv.org/pdf/2402.13064

GLAN generates synthetic data **from scratch** using a taxonomy of human knowledge:
- **Taxonomy** → **Disciplines** → **Subjects** → **Syllabus** → **Questions** → **Answers**

### 3.2 GLAN Pipeline

```python
def glan_instruction_generation():
    # Step 1: Generate taxonomy of human knowledge
    taxonomy = generate_taxonomy(max_number_of_fields=10)
    
    # Step 2: Extract disciplines from taxonomy
    disciplines = extract_disciplines_from_taxonomy(taxonomy)
    
    # Step 3: For each discipline, generate subjects
    for discipline in disciplines:
        subjects = generate_subjects(discipline)
        
        # Step 4: For each subject, generate syllabus at different levels
        for subject in subjects:
            syllabus = generate_syllabus(subject, level="beginner")
            
            # Step 5: Sample class sessions and key concepts
            sessions = sample_class_sessions_and_key_concepts(syllabus)
            
            # Step 6: Generate questions based on sessions
            questions = generate_questions(sessions, num_iterations=2)
            
            # Step 7: Generate answers for questions
            answers = generate_answers(questions)
            
            # Save Q&A pairs
            save_qa_pairs(questions, answers)
```

### 3.3 Tunable Parameters

```python
parser.add_argument("--max_number_of_fields", type=int, default=1)
parser.add_argument("--max_number_of_subjects", type=int, default=2)
parser.add_argument("--max_number_of_subtopics", type=int, default=5)
parser.add_argument("--max_number_of_session_name", type=int, default=3)

parser.add_argument("--num_iterations", type=int, default=2)
parser.add_argument("--num_questions_per_iteration", type=int, default=5)

parser.add_argument("--question_max_tokens", type=int, default=768)
parser.add_argument("--question_batch_size", type=int, default=5)
parser.add_argument("--answer_max_tokens", type=int, default=2048)
parser.add_argument("--answer_batch_size", type=int, default=5)
```

---

## 4. CODEBASE-SPECIFIC Q&A GENERATION

### 4.1 DeepCodeBench Approach
**Source**: https://www.qodo.ai/blog/deepcodebench-real-world-codebase-understanding-by-qa-benchmarking/

**Key Insight**: Use **Pull Requests** as context for realistic Q&A generation

#### Pipeline:
1. **Extract PR Context**: Retrieve code changes from PR
2. **Bundle Context**: Combine PR title, description, and related code snippets
3. **Generate Questions**: Prompt LLM with context to generate developer-relevant questions
4. **Generate Answers**: Use same context to generate answers

### 4.2 Question Generation Prompt (Codebase Context)

```python
SYSTEM_PROMPT = """You are helping build a high-quality dataset of real-world codebase questions 
to test our search AI agents. Each question should require the agent to search through the codebase 
to find the relevant code.

Guidelines:
- The question should be answerable with a short, concise response—ideally, a single short sentence.
- Despite the above, the question should still be answerable, and the context should be unambiguous.
- Don't make identifier references (function names, class names, variables, etc.) too obvious, 
  so that the search will be necessary.
- If a PR title and description are provided, use them only to infer the high-level subject of the question.
- Think of questions that the developer needs to know in order to address the PR.
- The question must still be answerable using the provided context.

Return the question, its type, whether it is a core question, and the relevant NODE IDENTIFIER headers 
from the context.
"""

USER_PROMPT = """
PR Title: {pr_title}
PR Description: {pr_description}

Code Context:
{code_context}

Generate exactly ONE onboarding question that requires searching through the codebase.
"""
```

### 4.3 Synthetic Q&A Data Format

```json
{
  "idx": 1,
  "Skill": "Distributed training on Cloud",
  "Difficulty": 5,
  "Instruction": "What version of TensorFlow was used in the evaluation?"
}

{
  "idx": 2,
  "Skill": "Distributed training on Cloud",
  "Difficulty": 5,
  "Instruction": "What is the first step to prepare the validation set for ImageNet training?"
}
```

### 4.4 Multi-Turn Q&A Format (Chat-based)

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are the SME (Subject Matter Expert) in Distributed training on Cloud. Please answer the questions accurately."
    },
    {
      "role": "user",
      "content": "What version of TensorFlow was used in the evaluation?"
    },
    {
      "role": "assistant",
      "content": "TensorFlow 1.13.1 was used in the evaluation."
    }
  ]
}
```

---

## 5. LLM-AS-JUDGE: Quality Filtering & Scoring

### 5.1 Microsoft LLM-as-Judge Framework
**Source**: https://github.com/microsoft/llm-as-judge

#### Architecture:
- **Judges**: Individual LLM instances with specific evaluation criteria
- **Assembly**: Group judges for comprehensive evaluation
- **SuperJudge**: Orchestrates multiple sub-judges
- **Mediator Pattern**: Judges notify SuperJudge of evaluation results

### 5.2 Judge Evaluation Prompt Template

```python
JUDGE_PROMPT = """
You will be given a user_question and system_answer couple. 
Your task is to provide a 'total rating' scoring how well the system_answer answers 
the user concerns expressed in the user_question.

Give your answer on a scale of 1 to 4, where:
1 = The system_answer is not helpful at all
2 = The system_answer is somewhat helpful but has significant issues
3 = The system_answer is mostly helpful with minor issues
4 = The system_answer is excellent and fully addresses the question

Provide your feedback as follows:

Evaluation: (your rationale for the rating, as a text)
Total rating: (your rating, as an integer between 1 and 4)

Question: {question}
Answer: {answer}
"""
```

### 5.3 Best Practices for LLM Judge

1. **Use Discrete Categories** (not 1-10 scale)
   - ✅ "Fully Correct", "Incomplete", "Contradictory"
   - ❌ 1-10 scale (causes "mean reversion" to 7)

2. **Pair-wise Comparison** (better than point-wise)
   - Compare two responses: "Response A > Response B"
   - More reliable than absolute scoring

3. **Chain-of-Thought Reasoning**
   - Force judge to write reasoning before final verdict
   - Increases accuracy and debuggability

4. **Few-Shot Examples**
   - Include 3-5 examples of varying quality
   - Shows judge what "Correct" vs "Fail" looks like

5. **Rubric-Based Evaluation**
   - Define explicit criteria (e.g., "Includes all key data points")
   - Mitigate biases with clear instructions

### 5.4 Code Quality Judge Prompt

```python
CODE_JUDGE_PROMPT = """
You are evaluating code quality. Assess the following code on these criteria:

1. **Correctness**: Does the code solve the problem correctly?
2. **Readability**: Is the code easy to understand?
3. **Efficiency**: Is the code reasonably efficient?
4. **Best Practices**: Does it follow language conventions?

Provide your assessment as:
- Reasoning: (explain your evaluation)
- Category: (Correct, Mostly Correct, Incorrect)

Code to evaluate:
{code}

Expected behavior:
{expected_behavior}
"""
```

### 5.5 Judge Orchestration Pattern

```python
class JudgeOrchestrator:
    def run_evaluation(self, assembly, prompt):
        """
        1. Create sub-judges from assembly
        2. Run each judge's evaluation
        3. Collect results via Mediator pattern
        4. SuperJudge produces final verdict
        """
        factory = JudgeFactory()
        sub_judges = factory.build_judges(assembly)
        
        results = {}
        for judge in sub_judges:
            result = judge.evaluate(prompt)
            results[judge.id] = result
        
        # SuperJudge aggregates results
        final_verdict = self.super_judge.aggregate(results)
        return final_verdict
```

---

## 6. COMPLETE PIPELINE: Cortex Auto-Scan Mode

### 6.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CORTEX AUTO-SCAN MODE                    │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
        ┌───────▼────────┐   │   ┌─────────▼────────┐
        │  CODEBASE      │   │   │  SEED TASKS      │
        │  SCANNER       │   │   │  (Optional)      │
        │                │   │   │                  │
        │ • Extract      │   │   │ • Domain-        │
        │   functions    │   │   │   specific       │
        │ • Parse AST    │   │   │ • 10-20 examples │
        │ • Chunk code   │   │   │                  │
        └────────┬───────┘   │   └──────────────────┘
                 │           │
                 └───────────┼───────────────┐
                             │               │
                    ┌────────▼────────┐     │
                    │ INSTRUCTION     │     │
                    │ GENERATION      │     │
                    │                 │     │
                    │ • Self-Instruct │     │
                    │ • Evol-Instruct │     │
                    │ • GLAN          │     │
                    └────────┬────────┘     │
                             │              │
                    ┌────────▼────────┐     │
                    │ INSTANCE        │     │
                    │ GENERATION      │     │
                    │                 │     │
                    │ • Generate      │     │
                    │   inputs        │     │
                    │ • Generate      │     │
                    │   outputs       │     │
                    └────────┬────────┘     │
                             │              │
                    ┌────────▼────────┐     │
                    │ LLM-AS-JUDGE    │◄────┘
                    │ FILTERING       │
                    │                 │
                    │ • Quality score │
                    │ • Similarity    │
                    │ • Relevance     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ TRAINING DATA   │
                    │ OUTPUT          │
                    │                 │
                    │ training_data   │
                    │ .jsonl          │
                    └─────────────────┘
```

### 6.2 Python/TypeScript Implementation Skeleton

```python
# cortex_autoscan.py

import json
import asyncio
from typing import List, Dict, Any
from dataclasses import dataclass
from enum import Enum

class GenerationStrategy(Enum):
    SELF_INSTRUCT = "self_instruct"
    EVOL_INSTRUCT = "evol_instruct"
    GLAN = "glan"

@dataclass
class CodeChunk:
    file_path: str
    content: str
    language: str
    start_line: int
    end_line: int

@dataclass
class GeneratedPair:
    instruction: str
    input: str
    output: str
    source_file: str
    difficulty: int
    strategy: GenerationStrategy

class CodebaseScanner:
    """Extract and chunk codebase for instruction generation"""
    
    def scan(self, repo_path: str) -> List[CodeChunk]:
        """Scan codebase and return chunks"""
        chunks = []
        # Implementation: walk directory, parse AST, chunk by function/class
        return chunks

class InstructionGenerator:
    """Generate instructions from code chunks"""
    
    async def generate_self_instruct(
        self, 
        chunks: List[CodeChunk],
        seed_tasks: List[str],
        num_iterations: int = 3
    ) -> List[str]:
        """Self-Instruct: iterative bootstrapping"""
        instructions = list(seed_tasks)
        
        for iteration in range(num_iterations):
            # Encode prompt from current instructions
            prompt = self.encode_prompt(instructions)
            
            # Generate new instructions
            new_instructions = await self.llm.generate(prompt)
            
            # Filter and add to pool
            filtered = self.filter_instructions(new_instructions)
            instructions.extend(filtered)
        
        return instructions
    
    async def generate_evol_instruct(
        self,
        instructions: List[str],
        num_evolutions: int = 4
    ) -> List[str]:
        """Evol-Instruct: complexity-driven evolution"""
        evolved = []
        
        for instruction in instructions:
            for _ in range(num_evolutions):
                # Randomly select evolution strategy
                strategy = random.choice([
                    "add_constraints",
                    "deepen",
                    "concretize",
                    "increase_reasoning",
                    "complicate_input",
                    "mutation"
                ])
                
                # Generate evolved instruction
                evolved_inst = await self.evolve(instruction, strategy)
                
                # Generate answer
                answer = await self.llm.generate(evolved_inst)
                
                evolved.append({
                    "instruction": evolved_inst,
                    "output": answer,
                    "strategy": strategy
                })
        
        return evolved
    
    def filter_instructions(self, instructions: List[str]) -> List[str]:
        """Filter low-quality instructions"""
        filtered = []
        
        for inst in instructions:
            # Length check
            if len(inst.split()) <= 3 or len(inst.split()) > 150:
                continue
            
            # Keyword filtering
            if any(kw in inst.lower() for kw in 
                   ["image", "graph", "picture", "file", "draw"]):
                continue
            
            # Similarity check (ROUGE)
            if self.is_too_similar(inst, filtered):
                continue
            
            filtered.append(inst)
        
        return filtered

class InstanceGenerator:
    """Generate input-output instances for instructions"""
    
    async def generate_instances(
        self,
        instructions: List[str],
        code_context: Dict[str, str]
    ) -> List[Dict[str, Any]]:
        """Generate input-output pairs for each instruction"""
        instances = []
        
        for instruction in instructions:
            # Create prompt with code context
            prompt = f"""
Given this code context:
{code_context}

Instruction: {instruction}

Generate a realistic input and output for this instruction.
Format as JSON: {{"input": "...", "output": "..."}}
"""
            
            response = await self.llm.generate(prompt)
            instance = json.loads(response)
            
            instances.append({
                "instruction": instruction,
                "input": instance.get("input", ""),
                "output": instance.get("output", ""),
                "code_context": code_context
            })
        
        return instances

class QualityJudge:
    """LLM-as-Judge for quality filtering"""
    
    async def evaluate(
        self,
        instruction: str,
        input_text: str,
        output_text: str
    ) -> Dict[str, Any]:
        """Evaluate quality of instruction-input-output triple"""
        
        prompt = f"""
You are evaluating a training example for code understanding.

Instruction: {instruction}
Input: {input_text}
Output: {output_text}

Evaluate on these criteria:
1. Relevance: Is the output relevant to the instruction?
2. Correctness: Is the output technically correct?
3. Clarity: Is the example clear and unambiguous?
4. Difficulty: Is the difficulty appropriate?

Provide:
- Reasoning: (explain your evaluation)
- Category: (Excellent, Good, Fair, Poor)
- Score: (1-4)
"""
        
        response = await self.llm.generate(prompt)
        
        return {
            "reasoning": response.get("reasoning"),
            "category": response.get("category"),
            "score": response.get("score"),
            "pass_filter": response.get("score") >= 3
        }

class AutoScanPipeline:
    """Main orchestration pipeline"""
    
    def __init__(self, repo_path: str, strategy: GenerationStrategy):
        self.repo_path = repo_path
        self.strategy = strategy
        self.scanner = CodebaseScanner()
        self.generator = InstructionGenerator()
        self.instance_gen = InstanceGenerator()
        self.judge = QualityJudge()
    
    async def run(self, output_file: str = "training_data.jsonl"):
        """Execute full pipeline"""
        
        # Step 1: Scan codebase
        print("Scanning codebase...")
        chunks = self.scanner.scan(self.repo_path)
        
        # Step 2: Generate instructions
        print("Generating instructions...")
        if self.strategy == GenerationStrategy.SELF_INSTRUCT:
            instructions = await self.generator.generate_self_instruct(chunks)
        elif self.strategy == GenerationStrategy.EVOL_INSTRUCT:
            instructions = await self.generator.generate_evol_instruct(chunks)
        else:  # GLAN
            instructions = await self.generator.generate_glan(chunks)
        
        # Step 3: Generate instances
        print("Generating instances...")
        instances = await self.instance_gen.generate_instances(
            instructions,
            {chunk.file_path: chunk.content for chunk in chunks}
        )
        
        # Step 4: Quality filtering
        print("Filtering by quality...")
        training_data = []
        
        for instance in instances:
            quality = await self.judge.evaluate(
                instance["instruction"],
                instance["input"],
                instance["output"]
            )
            
            if quality["pass_filter"]:
                training_data.append({
                    "prompt": f"{instance['instruction']}\n\nInput: {instance['input']}\n\nOutput:",
                    "completion": f" {instance['output']}<|endoftext|>",
                    "metadata": {
                        "source_file": instance.get("code_context"),
                        "quality_score": quality["score"],
                        "strategy": self.strategy.value
                    }
                })
        
        # Step 5: Save training data
        print(f"Saving {len(training_data)} examples to {output_file}...")
        with open(output_file, 'w') as f:
            for item in training_data:
                f.write(json.dumps(item) + '\n')
        
        return training_data

# Usage
if __name__ == "__main__":
    pipeline = AutoScanPipeline(
        repo_path="/path/to/cortex",
        strategy=GenerationStrategy.EVOL_INSTRUCT
    )
    
    asyncio.run(pipeline.run("cortex_training_data.jsonl"))
```

---

## 7. DATA FORMAT SPECIFICATIONS

### 7.1 OpenAI Fine-tuning Format (JSONL)

```json
{"prompt": "Instruction text\n\nInput: input_text\n\nOutput:", "completion": " output_text<|endoftext|>"}
```

### 7.2 Chat Format (Multi-turn)

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Question here"},
    {"role": "assistant", "content": "Answer here"}
  ]
}
```

### 7.3 Instruction-Input-Output Format

```json
{
  "instruction": "What does this function do?",
  "input": "def calculate_sum(a, b):\n    return a + b",
  "output": "This function takes two parameters and returns their sum.",
  "source_file": "utils.py",
  "difficulty": 3,
  "skill": "Code Understanding",
  "quality_score": 4
}
```

---

## 8. KEY IMPLEMENTATION PATTERNS

### 8.1 Similarity Filtering (ROUGE-based)

```python
from rouge_score import rouge_scorer

def is_too_similar(new_instruction, existing_instructions, threshold=0.7):
    scorer = rouge_scorer.RougeScorer(['rouge1'], use_stemmer=True)
    
    for existing in existing_instructions:
        scores = scorer.score(new_instruction, existing)
        if scores['rouge1'].fmeasure > threshold:
            return True
    
    return False
```

### 8.2 Batch Processing with Rate Limiting

```python
import asyncio
from typing import List

async def batch_generate(
    prompts: List[str],
    batch_size: int = 5,
    delay_between_batches: float = 1.0
):
    """Generate responses with rate limiting"""
    results = []
    
    for i in range(0, len(prompts), batch_size):
        batch = prompts[i:i+batch_size]
        
        # Process batch in parallel
        batch_results = await asyncio.gather(*[
            llm.generate(prompt) for prompt in batch
        ])
        
        results.extend(batch_results)
        
        # Rate limiting
        if i + batch_size < len(prompts):
            await asyncio.sleep(delay_between_batches)
    
    return results
```

### 8.3 Iterative Refinement Loop

```python
async def iterative_refinement(
    initial_instruction: str,
    max_iterations: int = 3,
    quality_threshold: float = 0.8
):
    """Refine instruction until quality threshold is met"""
    
    current = initial_instruction
    
    for iteration in range(max_iterations):
        # Evaluate current version
        quality = await judge.evaluate(current)
        
        if quality["score"] >= quality_threshold:
            return current
        
        # Refine based on feedback
        refinement_prompt = f"""
The following instruction needs improvement:
{current}

Feedback: {quality["reasoning"]}

Provide an improved version that addresses the feedback.
"""
        
        current = await llm.generate(refinement_prompt)
    
    return current
```

---

## 9. PRODUCTION CHECKLIST

- [ ] **Seed Tasks**: 10-20 domain-specific examples
- [ ] **Filtering Rules**: Define keyword blacklist, length constraints
- [ ] **Quality Thresholds**: Set minimum quality scores (e.g., 3/4)
- [ ] **Similarity Threshold**: ROUGE-1 F1 > 0.7 = duplicate
- [ ] **Rate Limiting**: Respect API limits (batch size, delays)
- [ ] **Error Handling**: Retry logic, fallback strategies
- [ ] **Monitoring**: Log generation stats, quality distribution
- [ ] **Validation**: Manual review of 50+ examples before production
- [ ] **Version Control**: Track data generation parameters
- [ ] **Output Format**: Validate JSONL format before fine-tuning

---

## 10. REFERENCES

1. **Self-Instruct**: https://github.com/yizhongw/self-instruct (arXiv:2212.10560)
2. **WizardLM/Evol-Instruct**: https://github.com/nlpxucan/WizardLM (arXiv:2304.12244)
3. **WizardCoder**: https://github.com/nlpxucan/WizardLM/tree/main/WizardCoder (arXiv:2306.08568)
4. **GLAN**: https://github.com/Azure/synthetic-qa-generation (arXiv:2402.13064)
5. **LLM-as-Judge**: https://github.com/microsoft/llm-as-judge
6. **DeepCodeBench**: https://www.qodo.ai/blog/deepcodebench-real-world-codebase-understanding-by-qa-benchmarking/
7. **Synthetic QA Generation**: https://github.com/Azure/synthetic-qa-generation
8. **CodeJudgeBench**: https://arxiv.org/pdf/2507.10535

