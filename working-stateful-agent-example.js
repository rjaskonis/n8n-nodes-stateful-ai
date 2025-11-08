const { RunnableSequence } = require("@langchain/core/runnables");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { AgentExecutor, createToolCallingAgent } = require("langchain/agents");

// ============================================
// Helper Functions
// ============================================

function formatConversationHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return "No previous conversation.";
  }
  return history.map(entry => `${entry.role}: ${entry.message}`).join("\n");
}

function cleanJsonResponse(jsonString) {
  let cleaned = jsonString.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
    cleaned = cleaned.replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

function prepareStateFieldsForTemplate(stateModel, state) {
  const result = {};
  for (const key of Object.keys(stateModel)) {
    const value = (key in state) ? state[key] : null;
    result[key] = (value === null || value === undefined) ? "" : value;
  }
  return result;
}

function parseToolResult(toolResult) {
  if (typeof toolResult !== 'string') {
    return toolResult;
  }
  try {
    return JSON.parse(toolResult);
  } catch (e) {
    return toolResult;
  }
}

async function invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps) {
  const invokedToolNames = [];
  
  for (const toolInvocation of toolsToInvoke) {
    const { tool_name, reason, input_params, state_field } = toolInvocation;
    
    const tool = agentTools.find(t => 
      t.name === tool_name || t.name.toLowerCase() === tool_name.toLowerCase()
    );
    
    if (!tool) {
      continue;
    }
    
    try {
      const toolResult = await tool.invoke(input_params || {});
      
      let targetField = state_field;
      if (!targetField && (tool_name.toLowerCase().includes('steps') || reason?.toLowerCase().includes('steps'))) {
        targetField = 'task_steps';
      }
      
      if (targetField && targetField in stateModel) {
        const parsedResult = parseToolResult(toolResult);
        
        if (JSON.stringify(state[targetField]) !== JSON.stringify(parsedResult)) {
          state[targetField] = parsedResult;
          if (!stateChangedProps.includes(targetField)) {
            stateChangedProps.push(targetField);
          }
        }
      }
      
      invokedToolNames.push(tool_name);
    } catch (error) {
      // Tool invocation failed, continue with other tools
    }
  }
  
  return invokedToolNames;
}

function validateAndExtractState(parsedResult, stateModel, state, prevStateModelOnly, stateChangedProps, isFirstRun) {
  const newState = parsedResult.state || {};
  
  for (const key of Object.keys(stateModel)) {
    if (!(key in newState)) {
      newState[key] = null;
    }
    state[key] = newState[key];
  }

  const changedProps = Object.keys(stateModel).filter(key => {
    const prevValue = prevStateModelOnly[key];
    const newValue = state[key];
    return JSON.stringify(prevValue) !== JSON.stringify(newValue);
  });
  
  if (isFirstRun && changedProps.length === 0) {
    return Object.keys(stateModel);
  }
  
  return changedProps;
}

// ============================================
// Get Inputs
// ============================================
const [llm] = await this.getInputConnectionData("ai_languageModel", 0);
const [mainInputData] = this.getInputData(0);

const user_message = mainInputData.json.user_message;
const system_prompt = mainInputData.json.system_prompt || "You're a helpful assistant";
const state_model = mainInputData.json.state_model;
const conversation_history = mainInputData.json.conversation_history || false;
const single_prompt_state_tracking = mainInputData.json.single_prompt_state_tracking !== false;

let allTools = [];
let memory = null;

try {
  allTools = await this.getInputConnectionData("ai_tool", 0) || [];
} catch (error) {
  allTools = [];
}

try {
  memory = await this.getInputConnectionData("ai_memory", 0);
} catch (error) {
  memory = null;
}

if (!user_message) {
  throw new Error("user_message is required but was not provided");
}

// ============================================
// Separate State Management Tool from Other Tools
// ============================================
let stateManagementTool = null;
let agentTools = [];

for (const tool of allTools) {
  if (tool.name === "State Management" || tool.name === "state_management" || tool.name.toLowerCase().includes("state")) {
    stateManagementTool = tool;
  } else {
    agentTools.push(tool);
  }
}

// ============================================
// Get Previous State
// ============================================
let prevState = {};
let state = {};
let stateChangedProps = [];

if (state_model || conversation_history) {
  if (!stateManagementTool) {
    throw new Error("State Management Tool is required but not connected");
  }

  const stateManagementResponse = await stateManagementTool.invoke({
    operation: "get",
    content: ""
  });

  const [previousStateData] = JSON.parse(stateManagementResponse);
  prevState = previousStateData || {};
}

// ============================================
// Initialize State
// ============================================
let conversationHistoryValue = null;
if (conversation_history) {
  conversationHistoryValue = prevState.conversation_history || [];
}

// ============================================
// Prepare State Model Data
// ============================================
let response;
let stateFieldDescriptions = "";
let prevStateModelOnly = {};
let isFirstRun = false;

if (state_model) {
  const prevStateHasFields = Object.keys(state_model).some(key => key in prevState);
  isFirstRun = !prevStateHasFields;
  
  for (const key of Object.keys(state_model)) {
    prevStateModelOnly[key] = (key in prevState) ? prevState[key] : null;
  }
  
  stateFieldDescriptions = Object.entries(state_model)
    .map(([key, description]) => `- ${key}: ${description}`)
    .join("\n");
}

const availableToolsDesc = agentTools.length > 0 
  ? agentTools.map(tool => `- ${tool.name}: ${tool.description || 'No description available'}`).join("\n")
  : "No tools available";

const useAgent = agentTools.length > 0;

if (state_model && single_prompt_state_tracking) {
  // ============================================
  // SINGLE REQUEST MODE: One call for state + response + tool identification
  // ============================================
  
  const combinedPrompt = PromptTemplate.fromTemplate(`
${system_prompt}

State Model (fields to track):
{stateFields}

Current State:
{currentState}

${useAgent ? `
Available Tools (you can request to use these if needed):
{availableTools}
` : ''}

${conversation_history ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

Instructions:
1. Analyze the user message and update state fields based on the state model
2. For each field in the state model, determine its value from the user message or keep the previous value
3. ${useAgent ? 'If you need external data to populate state fields or answer the user, specify which tools to invoke' : 'Provide a helpful response'}
4. Provide a natural, helpful response to the user

Respond with ONLY a valid JSON object in the following format:
{{
  "state": {{
    // Complete state object with all fields from state model
  }},
  ${useAgent ? `"tools_to_invoke": [
    // Array of tool invocation objects, or empty array if no tools needed
    // Only request tools if you truly need external data
    {{
      "tool_name": "Tool Name",
      "reason": "Why this tool is needed",
      "state_field": "field_name",
      "input_params": {{}}
    }}
  ],` : ''}
  "response": "Your helpful and natural response to the user"
}}
`);

  const combinedChain = RunnableSequence.from([
    combinedPrompt,
    llm,
    new StringOutputParser(),
  ]);

  const stateFieldsForTemplate = prepareStateFieldsForTemplate(state_model, prevStateModelOnly);
  
  const inputVariables = {
    user_message,
    stateFields: stateFieldDescriptions,
    currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
    ...stateFieldsForTemplate
  };
  
  if (useAgent) {
    inputVariables.availableTools = availableToolsDesc;
  }
  
  if (conversation_history && conversationHistoryValue) {
    inputVariables.conversation_history = formatConversationHistory(conversationHistoryValue);
  }

  const combinedResult = await combinedChain.invoke(inputVariables);

  let toolsToInvoke = [];
  try {
    const cleanedResult = cleanJsonResponse(combinedResult);
    const parsedResult = JSON.parse(cleanedResult);
    
    stateChangedProps = validateAndExtractState(
      parsedResult, 
      state_model, 
      state, 
      prevStateModelOnly, 
      stateChangedProps, 
      isFirstRun
    );

    response = parsedResult.response || "";
    
    if (useAgent) {
      toolsToInvoke = parsedResult.tools_to_invoke || [];
      
      if (!Array.isArray(toolsToInvoke)) {
        toolsToInvoke = [];
      }
    }
    
  } catch (error) {
    throw new Error(`Failed to parse combined JSON: ${error.message}`);
  }

  if (toolsToInvoke.length > 0) {
    const invokedToolNames = await invokeTools(toolsToInvoke, agentTools, state_model, state, stateChangedProps);
    
    if (invokedToolNames.length > 0) {
      const refinementPrompt = PromptTemplate.fromTemplate(`
${system_prompt}

Updated State (after tool invocations):
{updatedState}

${conversation_history ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

The following tools were invoked to gather information:
{toolsInvoked}

Now provide a complete, natural response to the user based on the updated state and tool results.
Respond with ONLY the response text (not JSON).
`);

      const refinementChain = RunnableSequence.from([
        refinementPrompt,
        llm,
        new StringOutputParser(),
      ]);
      
      const toolsInvokedDesc = invokedToolNames
        .map((name, idx) => `${idx + 1}. ${name}`)
        .join('\n');
      
      const stateModelFields = prepareStateFieldsForTemplate(state_model, state);
      
      const refinementInput = {
        user_message,
        updatedState: JSON.stringify(state, null, 2),
        toolsInvoked: toolsInvokedDesc,
        ...stateModelFields
      };
      
      if (conversation_history && conversationHistoryValue) {
        refinementInput.conversation_history = formatConversationHistory(conversationHistoryValue);
      }
      
      response = await refinementChain.invoke(refinementInput);
    }
  }

} else if (state_model && !single_prompt_state_tracking) {
  // ============================================
  // DOUBLE REQUEST MODE: Separate state analysis and response generation
  // ============================================
  
  const stateAnalysisPrompt = PromptTemplate.fromTemplate(`
You are analyzing a user message to update the conversation state and determine which tools should be invoked.

State Model (fields to track):
{stateFields}

Current State:
{currentState}

${useAgent ? `
Available Tools (name and description):
{availableTools}
` : ''}

${conversation_history ? `
Previous Conversation:
{conversation_history}
` : ''}

User Message: {userMessage}

Instructions:
1. Analyze the user message and determine the new state values based on the state model
2. For each field in the state model, determine its current value based on the user message and previous state
3. If a value hasn't changed or can't be determined from the message, keep the previous value
${useAgent ? `4. Identify which tools should be invoked to populate any state fields that require external data
5. For each tool that should be invoked, specify:
   - tool_name: the exact name of the tool
   - reason: why this tool should be invoked
   - state_field: which state field will be populated by this tool's result
   - input_params: the parameters to pass to the tool (as a JSON object)` : ''}

Respond with ONLY a valid JSON object in the following format:
{{
  "state": {{
    // Complete state object with all fields from state model
  }}${useAgent ? `,
  "tools_to_invoke": [
    // Array of tool invocation objects, or empty array if no tools needed
    {{
      "tool_name": "Tool Name",
      "reason": "Reason for invocation",
      "state_field": "field_name",
      "input_params": {{}}
    }}
  ]` : ''}
}}
`);

  const stateAnalysisChain = RunnableSequence.from([
    stateAnalysisPrompt,
    llm,
    new StringOutputParser(),
  ]);

  const stateAnalysisInput = {
    stateFields: stateFieldDescriptions,
    currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
    userMessage: user_message,
  };
  
  if (useAgent) {
    stateAnalysisInput.availableTools = availableToolsDesc;
  }
  
  if (conversation_history && conversationHistoryValue) {
    stateAnalysisInput.conversation_history = formatConversationHistory(conversationHistoryValue);
  }

  const stateAnalysisResult = await stateAnalysisChain.invoke(stateAnalysisInput);

  let toolsToInvoke = [];
  try {
    const cleanedResult = cleanJsonResponse(stateAnalysisResult);
    const parsedResult = JSON.parse(cleanedResult);
    
    stateChangedProps = validateAndExtractState(
      parsedResult, 
      state_model, 
      state, 
      prevStateModelOnly, 
      stateChangedProps, 
      isFirstRun
    );

    if (useAgent) {
      toolsToInvoke = parsedResult.tools_to_invoke || [];
    
      if (!Array.isArray(toolsToInvoke)) {
        toolsToInvoke = [];
      }
    }
    
  } catch (error) {
    throw new Error(`Failed to parse state analysis JSON: ${error.message}`);
  }

  if (toolsToInvoke.length > 0) {
    await invokeTools(toolsToInvoke, agentTools, state_model, state, stateChangedProps);
  }
  
  // Generate response using system_prompt with state variables
  const stateFieldsForPrompt = prepareStateFieldsForTemplate(state_model, state);
  
  const responsePrompt = PromptTemplate.fromTemplate(`
${system_prompt}

${conversation_history ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

Provide a helpful and natural response.
`);

  const responseChain = RunnableSequence.from([
    responsePrompt,
    llm,
    new StringOutputParser(),
  ]);

  const responseInput = {
    user_message,
    ...stateFieldsForPrompt
  };
  
  if (conversation_history && conversationHistoryValue) {
    responseInput.conversation_history = formatConversationHistory(conversationHistoryValue);
  }

  response = await responseChain.invoke(responseInput);

} else {
  // ============================================
  // SIMPLE PATH: No state_model (just response generation)
  // ============================================
  
  const stateForTemplate = {};
  for (const [key, value] of Object.entries(state)) {
    if (key !== 'conversation_history') {
      stateForTemplate[key] = (value === null || value === undefined) ? "" : value;
    }
  }
  
  const inputVariables = {
    user_message,
    ...stateForTemplate
  };

  if (conversation_history && conversationHistoryValue) {
    inputVariables.conversation_history = formatConversationHistory(conversationHistoryValue);
  }

  if (useAgent) {
    const agentPrompt = PromptTemplate.fromTemplate(`
${system_prompt}

${conversation_history ? `
Previous Conversation:
{conversation_history}
` : ''}

You have access to various tools that can help you answer questions and perform tasks.
Use the appropriate tools when needed to provide accurate and helpful responses.

User: {user_message}

Think step-by-step and use tools when they would be helpful.

{agent_scratchpad}
`);

    try {
      const agent = await createToolCallingAgent({
        llm,
        tools: agentTools,
        prompt: agentPrompt,
      });

      const agentExecutorConfig = {
        agent,
        tools: agentTools,
        verbose: true,
        maxIterations: 10,
        returnIntermediateSteps: false,
      };
      
      if (memory) {
        agentExecutorConfig.memory = memory;
      }

      const agentExecutor = new AgentExecutor(agentExecutorConfig);
      const result = await agentExecutor.invoke(inputVariables);
      response = result.output;
    } catch (error) {
      throw new Error(`Agent failed: ${error.message}`);
    }
  } else {
    const simplePrompt = PromptTemplate.fromTemplate(`
${system_prompt}

${conversation_history ? `
Previous Conversation:
{conversation_history}
` : ''}

User: {user_message}

Provide a helpful and natural response.
`);

    const chain = RunnableSequence.from([
      simplePrompt,
      llm,
      new StringOutputParser(),
    ]);

    response = await chain.invoke(inputVariables);
    
    if (memory && typeof memory.saveContext === 'function') {
      try {
        await memory.saveContext(
          { input: user_message },
          { output: response }
        );
      } catch (error) {
        // Failed to save to memory, continue
      }
    }
  }
}

// ============================================
// Update Conversation History and Save State
// ============================================
if (conversation_history) {
  conversationHistoryValue.push({
    role: "user",
    message: user_message
  });
  
  conversationHistoryValue.push({
    role: "assistant",
    message: response
  });
  
  state.conversation_history = conversationHistoryValue;
  
  if (!stateChangedProps.includes('conversation_history')) {
    stateChangedProps.push('conversation_history');
  }
}

if (stateManagementTool && stateChangedProps.length > 0) {
  await stateManagementTool.invoke({
    operation: "set",
    content: JSON.stringify(state),
  });
}

// ============================================
// Return Output
// ============================================
return [
  {
    json: {
      response: response,
      state: state,
      prevState: prevState,
      stateChangedProps: stateChangedProps,
    },
  },
];