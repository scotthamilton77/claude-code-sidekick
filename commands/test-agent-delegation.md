Test Agent Delegation Pattern: $ARGUMENTS

## Purpose

This command tests the agent delegation pattern where:
1. Main agent receives a query from user
2. Spawns subagent1 (joke-maker) to handle the query  
3. Subagent1 reads a template and spawns subagent2 (answer-agent) to get factual answer
4. Subagent2 stores the answer in a structured file
5. Subagent1 retrieves the answer and converts it to a joke
6. Final joke is reported back to the user

This mirrors the execute-continue.md pattern where implementation agents spawn architect agents for guidance.

## Process Flow

**Step 1**: Accept user query from $ARGUMENTS and create working directory

**Step 2**: Spawn joke-maker subagent with this prompt:

```
You are a joke-maker subagent tasked with turning factual answers into humorous jokes.

**Your Process**:

1. **Get Factual Answer First**:
   - Read the base answer-agent prompt from `~/.claude/.templates/answer-agent-prompt.md`  
   - Create a combined prompt by prepending this context:
   
   ```
   === SPECIFIC CONTEXT FOR THIS SESSION ===
   
   Query: {query}
   Working Directory: {workingDir}
   
   Please provide a factual, accurate answer to this query and store it in:
   {workingDir}/answer-{timestamp}.json
   
   Use this exact JSON format:
   {
     "query": "{query}",
     "answer": "your factual response here", 
     "timestamp": "current ISO timestamp",
     "confidence": "high|medium|low"
   }
   
   === BASE ANSWER AGENT INSTRUCTIONS ===
   
   [Insert complete content from ~/.claude/.templates/answer-agent-prompt.md here]
   ```
   
   - Use the Task tool to spawn the answer-agent with this combined prompt

2. **Retrieve the Answer**:
   - Use the Read tool to get the factual answer from the JSON file
   - Parse the JSON to extract the answer

3. **Create Joke**:
   - Transform the factual answer into a humorous joke  
   - Keep the core information accurate but add comedy
   - Write the joke to {workingDir}/final-joke.md

4. **Report Back**:
   - Display both the original factual answer and your joke version
   - Show the file locations for debugging

Query to process: {query}
Working directory: {workingDir}
```

**Step 3**: Read final joke file and display result to user

## Directory Structure

```
./test-delegation-{timestamp}/
├── answer-{timestamp}.json      # Factual answer from subagent2
└── final-joke.md               # Joke from subagent1  
```

## Implementation

The command should:

1. **Parse Arguments**: Extract query from $ARGUMENTS
2. **Create Session**: Make unique working directory  
3. **Spawn Joke-Maker**: Use Task tool with the joke-maker prompt above
4. **Return Results**: Display the final joke and session info

## Usage Examples

```bash
# Simple math question
/test-agent-delegation "What is 2+2?"

# Geography question
/test-agent-delegation "What is the capital of France?"

# Science question  
/test-agent-delegation "How many planets are in our solar system?"
```

## Expected Flow

1. **User**: `/test-agent-delegation "What is 2+2?"`

2. **Main Agent**: Creates `./test-delegation-12345/` and spawns joke-maker

3. **Joke-Maker (Subagent1)**:
   - Reads `~/.claude/.templates/answer-agent-prompt.md`
   - Creates combined prompt with "What is 2+2?" context
   - Spawns answer-agent

4. **Answer-Agent (Subagent2)**:
   - Receives combined prompt with query "What is 2+2?"
   - Stores: `{"query": "What is 2+2?", "answer": "4", "confidence": "high"}` 
   - Saves to `./test-delegation-12345/answer-12345.json`

5. **Joke-Maker (Subagent1)**:
   - Reads the answer file 
   - Creates joke: "Why was 2+2 so confident? Because it knew the answer was 4-sure!"
   - Saves to `./test-delegation-12345/final-joke.md`

6. **Main Agent**: Displays final joke to user

## Success Criteria

- [x] Template file created at `~/.claude/.templates/answer-agent-prompt.md`
- [ ] Main agent spawns joke-maker subagent successfully
- [ ] Joke-maker reads template and spawns answer-agent  
- [ ] Answer-agent stores JSON response in correct format
- [ ] Joke-maker retrieves answer and creates joke
- [ ] Final joke displayed to user
- [ ] All intermediate files created for debugging

## Arguments

**Query**: $ARGUMENTS (required)
- The question to be answered and converted to a joke
- Should be a single string containing the complete question

## Output

1. **Process Status**: Updates on delegation steps
2. **Factual Answer**: Original answer from answer-agent
3. **Final Joke**: Humorous version from joke-maker  
4. **File Locations**: Paths to intermediate files for debugging