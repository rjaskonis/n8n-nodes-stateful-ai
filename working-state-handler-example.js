const { RunnableSequence } = require("@langchain/core/runnables");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");

// ============================================
// Get Inputs
// ============================================
const [llm] = await this.getInputConnectionData("ai_languageModel", 0);
const [mainInputData] = this.getInputData(0);

// Get input parameters
const message = mainInputData.json.message;
const state_model = mainInputData.json.state_model;
const role = mainInputData.json.role || 'user';

// Get tools (with error handling for unsupported input types)
let allTools = [];

try {
  allTools = await this.getInputConnectionData("ai_tool", 0) || [];
} catch (error) {
  console.log("No ai_tool input connected");
  allTools = [];
}

// Validate required inputs
if (!message) {
  throw new Error("message is required but was not provided");
}

if (!state_model) {
  throw new Error("state_model is required but was not provided");
}

console.log("Inputs received:", { 
  message, 
  role,
  state_model_defined: !!state_model,
  total_tools: allTools.length
});

// ============================================
// Separate State Management Tool from Other Tools
// ============================================
let stateManagementTool = null;
let agentTools = [];

// Identify state management tool by name and separate from other tools
for (const tool of allTools) {
  if (tool.name === "State Management" || tool.name === "state_management" || tool.name.toLowerCase().includes("state")) {
    stateManagementTool = tool;
  } else {
    agentTools.push(tool);
  }
}

console.log("Tool separation:", {
  stateManagementTool: stateManagementTool?.name,
  agentTools: agentTools.map(t => t.name)
});

// Validate State Management Tool is connected
if (!stateManagementTool) {
  throw new Error("State Management Tool is required but not connected");
}

// ============================================
// Get Previous State
// ============================================
const stateManagementResponse = await stateManagementTool.invoke({
  operation: "get",
  content: ""
});

const [previousStateData] = JSON.parse(stateManagementResponse);
const prevState = previousStateData || {};

console.log("Previous State:", prevState);

// ============================================
// Update State based on state_model
// ============================================
let state = {};
let stateChangedProps = [];

// ============================================
// Handle Different Roles
// ============================================
if (role !== 'user') {
  // ============================================
  // SYSTEM ROLE: Direct state update
  // ============================================
  console.log("Processing system role message - direct state update");
  
  // Extract only state_model fields from previous state
  const prevStateModelOnly = {};
  for (const key of Object.keys(state_model)) {
    if (key in prevState) {
      prevStateModelOnly[key] = prevState[key];
    }
  }
  
  // Build state update prompt for system messages
  const stateFieldDescriptions = Object.entries(state_model)
    .map(([key, description]) => `- ${key}: ${description}`)
    .join("\n");
  
  const systemStatePrompt = PromptTemplate.fromTemplate(`
You are updating the conversation state based on a system message.

State Model (fields to track):
{stateFields}

Current State:
{currentState}

System Message: {systemMessage}

Instructions:
1. Analyze the system message and update the state values based on the state model
2. For each field in the state model, determine its current value based on the system message and previous state
3. If a value hasn't changed or can't be determined from the message, keep the previous value
4. Return the complete updated state

Respond with ONLY a valid JSON object representing the complete state (all fields from state model):
{{
  "field1": "value1",
  "field2": "value2",
  ...
}}
`);

  const systemStateChain = RunnableSequence.from([
    systemStatePrompt,
    llm,
    new StringOutputParser(),
  ]);

  const systemStateResult = await systemStateChain.invoke({
    stateFields: stateFieldDescriptions,
    currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
    systemMessage: message,
  });

  console.log("System state update result:", systemStateResult);

  try {
    // Strip markdown code blocks if present
    let cleanedResult = systemStateResult.trim();
    if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, '');
      cleanedResult = cleanedResult.replace(/\n?```\s*$/, '');
    }
    
    state = JSON.parse(cleanedResult.trim());
    
    // Validate all state_model keys exist
    for (const key of Object.keys(state_model)) {
      if (!(key in state)) {
        console.warn(`Missing state field: ${key}, setting to null`);
        state[key] = null;
      }
    }
    
    // Add system_last_message to the state
    state.system_last_message = message;
    
    // Track changed values (only for state_model fields)
    stateChangedProps = Object.keys(state_model).filter(key => {
      const prevValue = prevStateModelOnly[key];
      const newValue = state[key];
      return JSON.stringify(prevValue) !== JSON.stringify(newValue);
    });
    
    // Check if system_last_message changed
    if (prevState.system_last_message !== message) {
      stateChangedProps.push('system_last_message');
    }

    console.log("Updated State:", state);
    console.log("Changed Values:", stateChangedProps);
    
  } catch (error) {
    console.error("Failed to parse system state result:", error);
    throw new Error(`Failed to parse system state JSON: ${error.message}`);
  }

  // Save State
  if (stateChangedProps.length > 0) {
    await stateManagementTool.invoke({
      operation: "set",
      content: JSON.stringify(state),
    });
    console.log(`State saved successfully (changed fields: ${stateChangedProps.join(", ")})`);
  } else {
    console.log("No state changes detected, skipping state save");
  }

  // Return Output for system role
  return [
    {
      json: {
        state: state,
        prevState: prevState,
        stateChangedProps: stateChangedProps,
        role: role,
        message: stateChangedProps.length > 0 
          ? `System state updated successfully. Changed fields: ${stateChangedProps.join(", ")}`
          : "No state changes detected"
      },
    },
  ];
}

// ============================================
// USER ROLE: Full LLM analysis with tools
// ============================================
console.log("Processing user role message - full analysis with tools");

// Extract only state_model fields from previous state
const prevStateModelOnly = {};
for (const key of Object.keys(state_model)) {
  if (key in prevState) {
    prevStateModelOnly[key] = prevState[key];
  }
}

// Build state update prompt
const stateFieldDescriptions = Object.entries(state_model)
  .map(([key, description]) => `- ${key}: ${description}`)
  .join("\n");

// Prepare available tools description (excluding state management tool)
const availableToolsDesc = agentTools.map(tool => {
  return `- ${tool.name}: ${tool.description || 'No description available'}`;
}).join("\n");

// ============================================
// Combined: Update State & Identify Tools to Invoke
// ============================================
console.log("Analyzing user message to update state and identify required tools...");

const stateAndToolsPrompt = PromptTemplate.fromTemplate(`
You are analyzing a user message to update the conversation state and determine which tools should be invoked to populate missing information.

State Model (fields to track):
{stateFields}

Current State:
{currentState}

Available Tools (name and description):
{availableTools}

User Message: {userMessage}

Instructions:
1. Analyze the user message and determine the new state values based on the state model
2. For each field in the state model, determine its current value based on the user message and previous state
3. If a value hasn't changed or can't be determined from the message, keep the previous value
4. Identify which tools should be invoked to populate any state fields that require external data
5. For each tool that should be invoked, specify:
   - tool_name: the exact name of the tool
   - reason: why this tool should be invoked
   - state_field: which state field will be populated by this tool's result
   - input_params: the parameters to pass to the tool (as a JSON object)
6. IMPORTANT: Identify state fields that depend on tool results or other state fields and cannot be fully determined until after tools are invoked.
   For example:
   - A field that should be "the first element" of an array populated by a tool
   - A field that depends on processing tool results
   - A field that references other state fields that will be updated by tools
   List these fields in "fields_needing_post_analysis"

Respond with ONLY a valid JSON object in the following format:
{{
  "state": {{
    // Complete state object with all fields from state model
  }},
  "tools_to_invoke": [
    // Array of tool invocation objects, or empty array if no tools needed
    {{
      "tool_name": "Tool Name",
      "reason": "Reason for invocation",
      "state_field": "field_name",
      "input_params": {{}}
    }}
  ],
  "fields_needing_post_analysis": [
    // Array of state field names that need re-analysis after tools run, or empty array
    "field_name_1",
    "field_name_2"
  ]
}}
`);

const stateAndToolsChain = RunnableSequence.from([
  stateAndToolsPrompt,
  llm,
  new StringOutputParser(),
]);

const stateAndToolsResult = await stateAndToolsChain.invoke({
  stateFields: stateFieldDescriptions,
  currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
  availableTools: availableToolsDesc || "No tools available",
  userMessage: message,
});

console.log("State and tools analysis result:", stateAndToolsResult);

// ============================================
// Parse Result and Update State
// ============================================
let toolsToInvoke = [];
let stateFieldsWithDependencies = new Set();

try {
  // Strip markdown code blocks if present
  let cleanedResult = stateAndToolsResult.trim();
  if (cleanedResult.startsWith('```')) {
    cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, '');
    cleanedResult = cleanedResult.replace(/\n?```\s*$/, '');
  }
  
  const parsedResult = JSON.parse(cleanedResult.trim());
  
  // Extract state
  state = parsedResult.state || {};
  
  // Validate all state_model keys exist
  for (const key of Object.keys(state_model)) {
    if (!(key in state)) {
      console.warn(`Missing state field: ${key}, setting to null`);
      state[key] = null;
    }
  }

  // Track changed values (only for state_model fields)
  stateChangedProps = Object.keys(state_model).filter(key => {
    const prevValue = prevStateModelOnly[key];
    const newValue = state[key];
    return JSON.stringify(prevValue) !== JSON.stringify(newValue);
  });

  console.log("Updated State (state_model fields):", state);
  console.log("Changed Values:", stateChangedProps);

  // Extract tools to invoke
  toolsToInvoke = parsedResult.tools_to_invoke || [];
  
  if (!Array.isArray(toolsToInvoke)) {
    console.warn("tools_to_invoke is not an array, setting to empty array");
    toolsToInvoke = [];
  }
  
  console.log(`Tools to invoke: ${toolsToInvoke.length}`);
  
  // Extract fields needing post-analysis (LLM-identified dependencies)
  const fieldsNeedingPostAnalysis = parsedResult.fields_needing_post_analysis || [];
  
  if (Array.isArray(fieldsNeedingPostAnalysis)) {
    fieldsNeedingPostAnalysis.forEach(field => {
      if (field in state_model) {
        stateFieldsWithDependencies.add(field);
      }
    });
    
    if (stateFieldsWithDependencies.size > 0) {
      console.log("State fields needing post-analysis:", Array.from(stateFieldsWithDependencies));
    }
  }
  
} catch (error) {
  console.error("Failed to parse state and tools result:", error);
  throw new Error(`Failed to parse state and tools JSON: ${error.message}`);
}

// ============================================
// Invoke Identified Tools and Update State
// ============================================
const invokedToolResults = [];

if (toolsToInvoke.length > 0) {
  console.log(`Invoking ${toolsToInvoke.length} tools...`);
  
  for (const toolInvocation of toolsToInvoke) {
    const { tool_name, reason, input_params, state_field } = toolInvocation;
    
    // Find the tool by name
    const tool = agentTools.find(t => t.name === tool_name || t.name.toLowerCase() === tool_name.toLowerCase());
    
    if (!tool) {
      console.warn(`Tool "${tool_name}" not found in available tools, skipping...`);
      continue;
    }
    
    console.log(`Invoking tool "${tool_name}" - Reason: ${reason}`);
    console.log(`Input params:`, input_params);
    
    try {
      // Invoke the tool
      const toolResult = await tool.invoke(input_params || {});
      console.log(`Tool "${tool_name}" result:`, toolResult);
      
      // Store tool result for output
      invokedToolResults.push({
        tool_name,
        state_field,
        result: toolResult
      });
      
      // Directly update state with tool result
      let targetField = state_field;
      
      // If no state_field specified, try to infer from reason or tool name
      if (!targetField) {
        // Common pattern: "task_steps" if tool name contains "steps"
        if (tool_name.toLowerCase().includes('steps') || reason.toLowerCase().includes('steps')) {
          targetField = 'task_steps';
        }
      }
      
      if (targetField && targetField in state_model) {
        // Parse tool result if it's a JSON string
        let parsedResult = toolResult;
        if (typeof toolResult === 'string') {
          try {
            parsedResult = JSON.parse(toolResult);
          } catch (e) {
            // If not JSON, use as-is
            parsedResult = toolResult;
          }
        }
        
        // Update the specific state field
        if (JSON.stringify(state[targetField]) !== JSON.stringify(parsedResult)) {
          state[targetField] = parsedResult;
          if (!stateChangedProps.includes(targetField)) {
            stateChangedProps.push(targetField);
          }
          console.log(`State field "${targetField}" updated with tool result:`, parsedResult);
        }
      } else {
        console.warn(`Could not determine which state field to update for tool "${tool_name}"`);
      }
      
    } catch (error) {
      console.error(`Failed to invoke tool "${tool_name}":`, error.message);
      invokedToolResults.push({
        tool_name,
        state_field,
        error: error.message
      });
    }
  }
}

// ============================================
// Post-Tool Processing: Re-analyze State with Tool Results
// ============================================
// Only run second LLM call if:
// 1. Tools were invoked, AND
// 2. There are state fields with dependencies that might need updating
const needsPostToolAnalysis = invokedToolResults.length > 0 && stateFieldsWithDependencies.size > 0;

if (needsPostToolAnalysis) {
  console.log(`Re-analyzing state with tool results to update ${stateFieldsWithDependencies.size} dependent field(s): ${Array.from(stateFieldsWithDependencies).join(', ')}`);
  
  const toolResultsSummary = invokedToolResults.map(result => {
    return `Tool: ${result.tool_name}
Target State Field: ${result.state_field || 'not specified'}
Result: ${JSON.stringify(result.result || result.error, null, 2)}`;
  }).join('\n\n');
  
  const postToolStatePrompt = PromptTemplate.fromTemplate(`
You are analyzing tool results to update any remaining state fields that can now be determined.

State Model (fields to track):
{stateFields}

Current State (after initial analysis and tool invocations):
{currentState}

Tool Invocation Results:
{toolResults}

User Message (for context): {userMessage}

Instructions:
1. Review the current state and tool results
2. Identify any state fields that are currently null/unset but can now be determined from the tool results
3. Update those fields based on the tool results and state model descriptions
4. For fields that still cannot be determined, leave them as-is
5. Return the complete updated state

Respond with ONLY a valid JSON object representing the complete state (all fields from state model):
{{
  "field1": "value1",
  "field2": "value2",
  ...
}}
`);

  const postToolStateChain = RunnableSequence.from([
    postToolStatePrompt,
    llm,
    new StringOutputParser(),
  ]);

  const postToolStateResult = await postToolStateChain.invoke({
    stateFields: stateFieldDescriptions,
    currentState: JSON.stringify(state, null, 2),
    toolResults: toolResultsSummary,
    userMessage: message,
  });

  console.log("Post-tool state analysis result:", postToolStateResult);

  try {
    // Strip markdown code blocks if present
    let cleanedResult = postToolStateResult.trim();
    if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, '');
      cleanedResult = cleanedResult.replace(/\n?```\s*$/, '');
    }
    
    const updatedState = JSON.parse(cleanedResult.trim());
    
    // Compare and update state, tracking additional changes
    for (const key of Object.keys(state_model)) {
      if (key in updatedState && JSON.stringify(state[key]) !== JSON.stringify(updatedState[key])) {
        console.log(`Post-tool update: ${key} changed from ${JSON.stringify(state[key])} to ${JSON.stringify(updatedState[key])}`);
        state[key] = updatedState[key];
        if (!stateChangedProps.includes(key)) {
          stateChangedProps.push(key);
        }
      }
    }
    
  } catch (error) {
    console.error("Failed to parse post-tool state result:", error);
    console.warn("Continuing with current state without post-tool updates");
  }
} else {
  if (invokedToolResults.length > 0) {
    console.log("Skipping post-tool analysis: No state fields with dependencies detected");
  } else if (stateFieldsWithDependencies.size > 0) {
    console.log("Skipping post-tool analysis: No tools were invoked");
  }
}

// ============================================
// Save State
// ============================================
if (stateChangedProps.length > 0) {
  await stateManagementTool.invoke({
    operation: "set",
    content: JSON.stringify(state),
  });
  console.log(`State saved successfully (changed fields: ${stateChangedProps.join(", ")})`);
} else {
  console.log("No state changes detected, skipping state save");
}

// ============================================
// Return Output
// ============================================
return [
  {
    json: {
      state: state,
      prevState: prevState,
      stateChangedProps: stateChangedProps,
      toolsInvoked: invokedToolResults,
      role: role,
      message: stateChangedProps.length > 0 
        ? `State updated successfully. Changed fields: ${stateChangedProps.join(", ")}`
        : "No state changes detected"
    },
  },
];