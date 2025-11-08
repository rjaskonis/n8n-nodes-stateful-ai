# n8n-nodes-stateful-ai

Advanced AI agent nodes for n8n with intelligent state management and tool calling capabilities. Build sophisticated conversational AI applications that maintain context, track state across interactions, and dynamically invoke tools.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Nodes](#nodes)
  - [Stateful AI Agent](#stateful-ai-agent)
  - [AI State Handler](#ai-state-handler)
- [Features](#features)
- [Usage Examples](#usage-examples)
- [Configuration](#configuration)
- [Best Practices](#best-practices)
- [Compatibility](#compatibility)
- [Development](#development)
- [Resources](#resources)

## Overview

This package provides two powerful nodes for building stateful AI applications in n8n:

1. **Stateful AI Agent**: A complete conversational AI agent that handles user interactions, maintains state, and invokes tools dynamically
2. **AI State Handler**: A focused state management node that intelligently extracts and updates state from messages, with optional tool invocation

Both nodes work with any LangChain-compatible language model and support advanced features like conversation history, dynamic tool calling, and intelligent state tracking.

## Installation

### Community Node Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

### Manual Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/rjaskonis/n8n-nodes-stateful-agent.git
   cd n8n-nodes-stateful-agent
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the nodes:
   ```bash
   npm run build
   ```

4. Link to your n8n installation or copy the `dist` folder to your n8n custom nodes directory

## Getting Started

### Quick Start Guide

1. **Add a Language Model**: Connect an AI Language Model node (OpenAI, Claude, etc.) to your workflow
2. **Add State Management**: Create a sub-workflow or use a tool that handles state persistence (must support `get` and `set` operations)
3. **Choose Your Node**:
   - Use **Stateful AI Agent** for complete conversational AI with automatic responses
   - Use **AI State Handler** for focused state extraction and management
4. **Configure State Model**: Define the fields you want to track as a JSON object
5. **Connect Tools** (Optional): Add any tools the agent should be able to invoke

### Basic Workflow Example

```
[Webhook] → [Stateful AI Agent] → [Response]
              ↓
         [LLM Node]
              ↓
         [State Tool]
```

## Nodes

### Stateful AI Agent

The **Stateful AI Agent** is a complete conversational AI solution that handles user messages, maintains state, invokes tools, and generates natural responses.

#### Use Cases

- Conversational chatbots and assistants
- Multi-turn dialogue systems
- Context-aware AI applications
- Agent workflows with tool integration

#### Input Connections

- **Main Input** (Required): Data flow input
- **Language Model** (Required): Any LangChain-compatible LLM (OpenAI, Claude, etc.)
- **State** (Required if using state): State management tool/sub-workflow
- **Tools** (Optional, Multiple): AI tools the agent can invoke

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| **User Message** | String | Yes | The message from the user that the agent should respond to |
| **System Prompt** | String | No | Defines the agent's behavior and personality (default: "You're a helpful assistant") |
| **State Model** | JSON | No | JSON object defining state fields to track. Each key is a field name and value is its description |
| **Enable Conversation History** | Boolean | No | Track and maintain conversation history across interactions (default: false) |
| **Single Prompt State Tracking** | Boolean | No | Use single prompt mode (faster) or double prompt mode (more accurate) (default: true) |

#### Output Format

```json
{
  "response": "The agent's natural language response to the user",
  "state": {
    "field1": "value1",
    "field2": "value2",
    "conversation_history": [
      {"role": "user", "message": "..."},
      {"role": "assistant", "message": "..."}
    ]
  },
  "prevState": {
    "field1": "old_value1"
  },
  "stateChangedProps": ["field1", "field2"]
}
```

#### Key Features

- **Automatic Response Generation**: Generates natural language responses to user messages
- **State Tracking**: Extracts and maintains structured state across interactions
- **Dynamic Tool Calling**: Automatically identifies and invokes tools when needed
- **Conversation History**: Maintains context across multiple turns
- **Two Prompt Modes**: Single prompt (faster) or double prompt (more accurate)

### AI State Handler

The **AI State Handler** is a focused state management node that intelligently extracts and updates state from messages, with optional tool invocation for gathering external data.

#### Use Cases

- State extraction from user messages
- Pre-processing before other AI operations
- System-driven state updates
- Workflows where you need state management separate from response generation

#### Input Connections

- **Main Input** (Required): Data flow input
- **Language Model** (Required): Any LangChain-compatible LLM
- **State** (Required): State management tool/sub-workflow
- **Tools** (Optional, Multiple): AI tools for gathering external data

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| **Role** | Options | No | Message role: "User" (triggers full analysis with tools) or "System" (direct state update) (default: "user") |
| **Message** | String | Yes | The message to process for state updates |
| **State Model** | JSON | Yes | JSON object defining state fields to track. Each key is a field name and value is its description |

#### Output Format

```json
{
  "state": {
    "field1": "value1",
    "field2": "value2"
  },
  "prevState": {
    "field1": "old_value1"
  },
  "stateChangedProps": ["field1"],
  "toolsInvoked": [
    {
      "tool_name": "Weather API",
      "state_field": "weather_info",
      "result": {...}
    }
  ],
  "role": "user",
  "message": "State updated successfully. Changed fields: field1"
}
```

#### Key Features

- **Intelligent State Extraction**: Uses LLM to extract structured state from natural language
- **Role-Based Processing**: Different behavior for user vs system messages
- **Post-Tool Analysis**: Re-analyzes state after tool invocations to update dependent fields
- **Tool Integration**: Automatically invokes tools to gather data for state fields
- **No Response Generation**: Focuses solely on state management

## Features

### State Management

- **Structured State Tracking**: Define custom state models with field descriptions
- **Automatic State Extraction**: LLM-powered extraction from natural language
- **State Persistence**: Save and retrieve state across workflow executions
- **Change Detection**: Track which state fields changed in each interaction

### Tool Integration

- **Dynamic Tool Selection**: Automatically identifies which tools to invoke
- **Tool Result Processing**: Processes tool results and updates state accordingly
- **Multiple Tool Support**: Connect multiple tools for complex workflows
- **Post-Tool Analysis**: Re-analyzes state after tool invocations

### Conversation Management

- **Conversation History**: Maintains full conversation context (Stateful AI Agent only)
- **Multi-turn Context**: Remembers previous interactions
- **Context-Aware Responses**: Generates responses based on conversation history

### Flexibility

- **Any LangChain LLM**: Works with OpenAI, Claude, and other LangChain-compatible models
- **Customizable Prompts**: Full control over system prompts and behavior
- **Two Prompt Modes**: Choose between speed and accuracy
- **Role-Based Processing**: Different handling for user vs system messages

## Usage Examples

### Example 1: Simple Travel Assistant (Stateful AI Agent)

**Configuration:**
- **User Message**: `"I want to visit Tokyo in March with a $2000 budget"`
- **System Prompt**: `"You are a helpful travel assistant. Help users plan their trips."`
- **State Model**:
  ```json
  {
    "destination": "Travel destination",
    "travel_month": "Month of travel",
    "budget": "Travel budget",
    "recommendations": "Recommended activities or hotels"
  }
  ```
- **Enable Conversation History**: `true`

**Result**: The agent extracts destination (Tokyo), month (March), and budget ($2000), then provides travel recommendations while maintaining this context for future interactions.

### Example 2: Weather State Tracking (AI State Handler)

**Configuration:**
- **Role**: `"user"`
- **Message**: `"What's the weather in Paris?"`
- **State Model**:
  ```json
  {
    "location": "The location to check weather for",
    "weather_info": "Current weather information"
  }
  ```
- **Connected Tool**: Weather API tool

**Result**: The handler extracts the location (Paris), invokes the Weather API tool, stores the weather information in state, and returns the updated state without generating a response.

### Example 3: System-Driven State Update (AI State Handler)

**Configuration:**
- **Role**: `"system"`
- **Message**: `"User has completed onboarding. Set status to active and grant premium access."`
- **State Model**:
  ```json
  {
    "user_status": "User account status",
    "access_level": "User access level",
    "onboarding_complete": "Whether onboarding is complete"
  }
  ```

**Result**: The handler directly updates state based on the system message without tool invocation, setting status to "active" and access_level to "premium".

### Example 4: Multi-turn Conversation (Stateful AI Agent)

**Turn 1:**
- User: `"I'm planning a vacation"`
- State Model: `{"planning_stage": "...", "destination": "...", "interests": "..."}`

**Turn 2:**
- User: `"I love beaches and warm weather"`
- (State and conversation history automatically carried over)

**Result**: The agent remembers the context from Turn 1 and can provide relevant beach destination recommendations based on the user's interests.

## Configuration

### State Model Format

The State Model is a JSON object where each key is a field name and the value is a description of what that field tracks:

```json
{
  "field_name": "Description of what this field tracks",
  "another_field": "Another description"
}
```

**Best Practices:**
- Use clear, descriptive field names (snake_case recommended)
- Provide detailed descriptions for each field
- Keep the number of fields manageable (5-10 is optimal)
- Use specific descriptions that help the LLM understand the field's purpose

### State Management Tool Requirements

The State Management Tool (connected to the "State" input) must support:

- **`get` operation**: Retrieve current state
  ```javascript
  await tool.invoke({
    operation: "get",
    content: ""
  });
  // Should return: JSON string of state object or array with state object
  ```

- **`set` operation**: Save updated state
  ```javascript
  await tool.invoke({
    operation: "set",
    content: JSON.stringify(state)
  });
  ```

### System Prompt Guidelines

- **Be Specific**: Clearly define the agent's role and capabilities
- **Reference State**: Mention state fields by name when relevant
- **Set Expectations**: Explain how the agent should behave
- **Include Guidelines**: Provide instructions for tool usage and responses

**Example:**
```
You are a travel planning assistant. You help users plan trips by:
- Extracting destination, dates, and budget from their messages
- Providing recommendations for hotels, activities, and restaurants
- Remembering their preferences across conversations

Always be friendly and provide detailed, personalized suggestions based on the user's stated preferences and budget.
```

## Best Practices

### State Model Design

1. **Keep it Focused**: Track only essential information
2. **Use Clear Names**: Field names should be self-explanatory
3. **Detailed Descriptions**: Help the LLM understand each field's purpose
4. **Avoid Redundancy**: Don't track information that can be derived from other fields

### Node Selection

- **Use Stateful AI Agent** when you need:
  - Complete conversational AI with automatic responses
  - Multi-turn conversations with history
  - End-to-end user interaction handling

- **Use AI State Handler** when you need:
  - State extraction without response generation
  - System-driven state updates
  - Pre-processing before other operations
  - More control over response generation

### Performance Optimization

1. **Single vs Double Prompt Mode**:
   - Use Single Prompt Mode for simple interactions (faster)
   - Use Double Prompt Mode when state accuracy is critical (more accurate)

2. **Conversation History**:
   - Only enable when building multi-turn conversations
   - Be aware that history grows over time

3. **Tool Management**:
   - Limit the number of connected tools to improve response time
   - Ensure tools have clear names and descriptions
   - Test tools independently before connecting

### Error Handling

- Always validate State Model JSON before use
- Ensure State Management Tool is properly connected
- Handle cases where tools fail gracefully
- Use `continueOnFail()` for non-critical operations

## Compatibility

- **Minimum n8n version**: 1.0.0
- **Tested with**: n8n 1.x
- **LangChain version**: ^0.1.0
- **Node.js**: >= 18.x

## Development

### Project Structure

```
n8n-nodes-stateful-ai/
├── nodes/
│   ├── StatefulAIAgent/     # Stateful AI Agent node
│   ├── AIStateHandler/       # AI State Handler node
│   ├── Example/              # Example nodes
│   └── Stuff/
├── dist/                     # Compiled output
├── package.json
└── tsconfig.json
```

### Scripts

- `npm run build` - Build the nodes
- `npm run build:watch` - Watch mode for development
- `npm run lint` - Lint the code
- `npm run lint:fix` - Fix linting issues
- `npm run dev` - Development mode

### Building

```bash
npm install
npm run build
```

The compiled nodes will be in the `dist` folder.

## Resources

- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/#community-nodes)
- [LangChain Documentation](https://js.langchain.com/)
- [Detailed Usage Guide](./STATEFUL_AGENT_USAGE.md)
- [GitHub Repository](https://github.com/rjaskonis/n8n-nodes-stateful-agent)

## License

MIT

## Author

Renne Jaskonis (rjaskonis@gmail.com)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
