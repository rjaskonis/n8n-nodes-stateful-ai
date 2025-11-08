# Stateful AI Agent Node - Usage Guide

## Overview

The **Stateful AI Agent** is an advanced n8n node that provides sophisticated AI agent capabilities with state management and tool calling. It allows you to build conversational AI applications that can:

- Track state across multiple interactions
- Maintain conversation history
- Invoke external tools dynamically
- Use any LangChain-compatible LLM
- Switch between single-prompt and double-prompt modes for optimization

## Installation

1. Make sure all dependencies are installed:
```bash
npm install
```

2. Build the node:
```bash
npm run build
```

3. The node will be available in n8n under the "Transform" category as "Stateful AI Agent"

## Node Configuration

### Input Connections

The Stateful AI Agent node requires and accepts the following connections:

1. **Main Input** (Required): The data flow input
2. **Language Model** (Required): An AI Language Model connection (e.g., OpenAI, Claude, etc.)
3. **Tools** (Optional, Multiple): AI Tool connections that the agent can invoke
4. **Memory** (Optional): AI Memory connection for conversation management
5. **State Management Tool** (Required if using state): A tool that handles state persistence

### Node Parameters

#### 1. User Message (Required)
The message from the user that the agent should respond to.

**Example:**
```
What's the weather like today?
```

#### 2. System Prompt (Optional)
Defines the agent's behavior and personality. Default: "You're a helpful assistant"

**Example:**
```
You are a helpful travel assistant. You help users plan their trips by providing 
recommendations for destinations, hotels, and activities. Always be friendly and 
provide detailed suggestions.
```

#### 3. State Model (Optional)
A JSON object defining the state fields to track. Each key is a field name and the value is its description.

**Example:**
```json
{
  "destination": "The travel destination the user is interested in",
  "travel_dates": "The dates for the trip",
  "budget": "The user's budget for the trip",
  "preferences": "User's travel preferences (beach, mountains, city, etc.)"
}
```

#### 4. Enable Conversation History (Boolean)
Whether to track and maintain conversation history across interactions. Default: `false`

When enabled, the agent will remember previous messages and can reference them in responses.

#### 5. Single Prompt State Tracking (Boolean)
Whether to use single prompt mode (faster) or double prompt mode (more accurate). Default: `true`

- **Single Prompt Mode**: The agent analyzes the message, updates state, identifies tools, and generates a response in one LLM call. Faster but less accurate for complex state tracking.
- **Double Prompt Mode**: Separate calls for state analysis and response generation. More accurate but slower.

## Usage Examples

### Example 1: Simple Conversational Agent (No State)

**Configuration:**
- User Message: `"What is artificial intelligence?"`
- System Prompt: `"You're a helpful assistant"`
- State Model: (empty)
- Conversation History: Disabled

**Result:** The agent will provide a simple response without tracking any state.

### Example 2: Agent with State Tracking

**Configuration:**
- User Message: `"I want to visit Paris in June with a budget of $3000"`
- System Prompt: `"You are a travel planning assistant"`
- State Model:
```json
{
  "destination": "Travel destination",
  "travel_month": "Month of travel",
  "budget": "Travel budget",
  "recommendations": "Recommended activities or hotels"
}
```
- Conversation History: Enabled

**Result:** The agent will:
1. Extract and store the destination (Paris), travel month (June), and budget ($3000)
2. Provide relevant recommendations
3. Remember this information for subsequent interactions

### Example 3: Agent with Tool Calling

**Setup:**
- Connect a "Weather API" tool to the Tools input
- Connect a "State Management" tool

**Configuration:**
- User Message: `"What's the weather in Tokyo?"`
- System Prompt: `"You're a helpful weather assistant"`
- State Model:
```json
{
  "location": "The location to check weather for",
  "weather_info": "Current weather information"
}
```

**Result:** The agent will:
1. Identify the location (Tokyo)
2. Invoke the Weather API tool to fetch current weather
3. Store the weather information in state
4. Provide a natural response with the weather details

### Example 4: Multi-turn Conversation with History

**Turn 1:**
- User Message: `"I'm planning a vacation"`
- Conversation History: Enabled
- State Model:
```json
{
  "planning_stage": "Current stage of trip planning",
  "destination": "Chosen destination",
  "interests": "User's interests"
}
```

**Turn 2:**
- User Message: `"I love beaches and warm weather"`
- (State and conversation history carried over from Turn 1)

**Result:** The agent remembers the context from Turn 1 and can provide relevant beach destination recommendations.

## State Management

### How State Works

1. **State Initialization**: On first run, all state fields are set to `null`
2. **State Updates**: The agent analyzes user messages and updates relevant state fields
3. **State Persistence**: Changed state fields are saved using the State Management Tool
4. **State Retrieval**: Previous state is loaded on each interaction

### State Management Tool Requirements

The State Management Tool must support:
- **get** operation: Retrieve current state
- **set** operation: Save updated state

The tool should return state in the format:
```json
[{
  "field1": "value1",
  "field2": "value2",
  "conversation_history": [
    {"role": "user", "message": "..."},
    {"role": "assistant", "message": "..."}
  ]
}]
```

## Output Format

The node returns an object with the following structure:

```json
{
  "response": "The agent's response to the user",
  "state": {
    // Current state with all tracked fields
  },
  "prevState": {
    // Previous state before this interaction
  },
  "stateChangedProps": [
    // Array of field names that changed in this interaction
  ]
}
```

## Best Practices

### 1. State Model Design
- Keep state fields focused and specific
- Use clear, descriptive field names
- Provide detailed descriptions for each field
- Don't track too many fields (5-10 is optimal)

### 2. System Prompts
- Be specific about the agent's role and capabilities
- Include guidelines for how the agent should behave
- Reference state fields by name in the prompt when needed

### 3. Tool Integration
- Give tools clear, descriptive names
- Provide detailed descriptions for each tool
- Ensure tools return structured, parseable data

### 4. Performance Optimization
- Use Single Prompt Mode for simple interactions
- Use Double Prompt Mode when state accuracy is critical
- Consider disabling conversation history if not needed
- Limit the number of connected tools to improve response time

### 5. Conversation History
- Only enable when building multi-turn conversations
- Be aware that history grows over time (may need pruning logic)
- History is stored as part of state

## Troubleshooting

### Agent doesn't track state
- Ensure State Management Tool is connected
- Verify State Model is valid JSON
- Check that state field descriptions are clear

### Tools aren't being invoked
- Verify tools are properly connected
- Ensure tool names and descriptions are clear
- Check tool input parameters are correct
- Use Double Prompt Mode for better tool identification

### Conversation history not working
- Ensure "Enable Conversation History" is checked
- Verify State Management Tool is connected
- Check that previous state is being loaded correctly

### Response quality issues
- Refine the System Prompt with more specific instructions
- Try switching between Single/Double Prompt modes
- Ensure State Model descriptions are detailed
- Verify the Language Model is working correctly

## Advanced Use Cases

### Dynamic Tool Selection
The agent can intelligently select which tools to use based on the user's message and current state. It will only invoke tools when truly needed.

### Context-Aware Responses
By maintaining state, the agent can provide personalized responses based on information gathered across multiple interactions.

### Workflow Integration
Use the `stateChangedProps` output to trigger different branches in your n8n workflow based on what state fields changed.

## Development

### Building
```bash
npm run build
```

### Watching for Changes
```bash
npm run build:watch
```

### Linting
```bash
npm run lint
npm run lint:fix
```

## License

MIT

