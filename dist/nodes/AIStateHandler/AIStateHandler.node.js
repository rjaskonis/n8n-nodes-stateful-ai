"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIStateHandler = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const runnables_1 = require("@langchain/core/runnables");
const prompts_1 = require("@langchain/core/prompts");
const output_parsers_1 = require("@langchain/core/output_parsers");
class AIStateHandler {
    constructor() {
        this.description = {
            displayName: 'AI State Handler',
            name: 'aiStateHandler',
            icon: 'file:aistatehandler.svg',
            group: ['transform'],
            version: 1,
            subtitle: '={{$parameter["message"]}}',
            description: 'Intelligent state management for AI conversations',
            codex: {
                categories: ['AI'],
                subcategories: {
                    AI: ['Tools'],
                },
            },
            defaults: {
                name: 'AI State Handler',
            },
            inputs: [
                n8n_workflow_1.NodeConnectionTypes.Main,
                {
                    type: n8n_workflow_1.NodeConnectionTypes.AiLanguageModel,
                    displayName: 'LLM',
                    required: true,
                    maxConnections: 1,
                },
                {
                    type: n8n_workflow_1.NodeConnectionTypes.AiTool,
                    displayName: 'Tools',
                    maxConnections: undefined,
                },
            ],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            properties: [
                {
                    displayName: 'State Management Workflow',
                    name: 'stateWorkflowId',
                    type: 'workflowSelector',
                    default: '',
                    required: true,
                    description: 'Select the workflow that handles state storage. The workflow must have an Execute Workflow Trigger with "operation" (supporting "get" and "set" values) and "content" input fields.',
                },
                {
                    displayName: 'This node will send "get" or "set" to the "operation" field and the state content to the "content" field when calling the State Management Workflow. By using this workflow approach, you can track and store state in any way you prefer - whether it\'s in a database, file system, cloud storage, or any other storage solution that fits your needs.',
                    name: 'stateWorkflowInfo',
                    type: 'notice',
                    default: '',
                },
                {
                    displayName: 'Session ID',
                    name: 'sessionId',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Unique identifier for the conversation session',
                },
                {
                    displayName: 'Role',
                    name: 'role',
                    type: 'options',
                    options: [
                        {
                            name: 'User',
                            value: 'user',
                        },
                        {
                            name: 'System',
                            value: 'system',
                        },
                    ],
                    default: 'user',
                    description: 'The role to process (user message or system extraction)',
                },
                {
                    displayName: 'Message',
                    name: 'message',
                    type: 'string',
                    default: '={{ $json.message }}',
                    required: true,
                    description: 'The message to process',
                },
                {
                    displayName: 'State Model',
                    name: 'stateModel',
                    type: 'json',
                    default: '{\n  "name": "User name"\n}',
                    description: 'JSON object defining the state structure and descriptions',
                },
            ],
        };
    }
    static cleanJsonResponse(jsonString) {
        let cleaned = jsonString.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
            cleaned = cleaned.replace(/\n?```\s*$/, '');
        }
        return cleaned.trim();
    }
    static parseToolResult(toolResult) {
        if (typeof toolResult !== 'string') {
            return toolResult;
        }
        try {
            return JSON.parse(toolResult);
        }
        catch (e) {
            return toolResult;
        }
    }
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                const message = this.getNodeParameter('message', itemIndex);
                const stateModelStr = this.getNodeParameter('stateModel', itemIndex);
                const role = this.getNodeParameter('role', itemIndex, 'user');
                if (!message) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'message is required but was not provided', {
                        itemIndex,
                    });
                }
                if (!stateModelStr || !stateModelStr.trim()) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'state_model is required but was not provided', {
                        itemIndex,
                    });
                }
                let stateModel;
                try {
                    stateModel = JSON.parse(stateModelStr);
                }
                catch (error) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Invalid State Model JSON: ${error.message}`, {
                        itemIndex,
                    });
                }
                const llm = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiLanguageModel, 0));
                if (!llm) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'LLM is required but not connected', {
                        itemIndex,
                    });
                }
                const stateWorkflowIdParam = this.getNodeParameter('stateWorkflowId', itemIndex);
                const stateWorkflowId = typeof stateWorkflowIdParam === 'object' && stateWorkflowIdParam !== null
                    ? stateWorkflowIdParam.value
                    : stateWorkflowIdParam;
                const sessionId = this.getNodeParameter('sessionId', itemIndex);
                if (!stateWorkflowId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'State Management Workflow is required. Please select a workflow.', {
                        itemIndex,
                    });
                }
                if (!sessionId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Session ID is required. Please provide a session identifier.', {
                        itemIndex,
                    });
                }
                let agentTools = [];
                try {
                    const toolsResult = await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiTool, 0);
                    if (toolsResult) {
                        if (Array.isArray(toolsResult)) {
                            agentTools = toolsResult.filter((tool) => tool && typeof tool.invoke === 'function');
                        }
                        else if (typeof toolsResult.invoke === 'function') {
                            agentTools = [toolsResult];
                        }
                    }
                }
                catch (error) {
                }
                const callStateWorkflow = async (operation, content = '') => {
                    var _a, _b;
                    const inputData = {
                        sessionId,
                        operation,
                        content,
                    };
                    const result = await this.executeWorkflow({ id: stateWorkflowId }, [{
                            json: inputData
                        }]);
                    if (!((_b = (_a = result === null || result === void 0 ? void 0 : result.data) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b[0])) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'State Management workflow returned no data', {
                            itemIndex,
                        });
                    }
                    return result.data[0][0].json;
                };
                const stateData = await callStateWorkflow("get");
                const prevState = stateData || {};
                let state = {};
                let stateChangedProps = [];
                const prevStateModelOnly = {};
                for (const key of Object.keys(stateModel)) {
                    if (key in prevState) {
                        prevStateModelOnly[key] = prevState[key];
                    }
                }
                const stateFieldDescriptions = Object.entries(stateModel)
                    .map(([key, description]) => `- ${key}: ${description}`)
                    .join("\n");
                if (role !== 'user') {
                    const systemStatePrompt = prompts_1.PromptTemplate.fromTemplate(`
You are updating the conversation state based on a system message.

State Model (fields to track):
{stateFields}

Current State:
{currentState}

System Message: {systemMessage}

Instructions:
1. Analyze the system message CAREFULLY and update the state values based on the state model
2. CRITICAL: Only update state fields when there is CLEAR and EXPLICIT evidence in the message. Do NOT make assumptions or infer values from ambiguous content.
3. IMPORTANT extraction rules:
   - For name fields: Only extract if the message explicitly contains a name (e.g., "User's name is John", "Set name to Maria"). Do NOT extract names from greetings, casual expressions, or ambiguous content.
   - For other fields: Only extract if the message contains clear, unambiguous information related to that field's description. If the message is vague, ambiguous, or doesn't contain relevant information, keep the previous value or set to null.
   - Consider context: Be aware that words in different languages may have different meanings. A greeting in one language should not be mistaken for a name or other field value.
   - Language awareness: Be aware that words in different languages may have different meanings. Only extract values when there is clear, explicit information.
4. For each field in the state model, determine its current value based on the system message and previous state:
   - If the message contains clear, explicit information about the field, update it
   - If the value hasn't changed or can't be determined from the message, keep the previous value (or null if no previous value exists)
5. Return the complete updated state

Respond with ONLY a valid JSON object representing the complete state (all fields from state model):
{{
  "field1": "value1",
  "field2": "value2",
  ...
}}
`);
                    const systemStateChain = runnables_1.RunnableSequence.from([
                        systemStatePrompt,
                        llm,
                        new output_parsers_1.StringOutputParser(),
                    ]);
                    const systemStateResult = await systemStateChain.invoke({
                        stateFields: stateFieldDescriptions,
                        currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
                        systemMessage: message,
                    });
                    try {
                        const cleanedResult = AIStateHandler.cleanJsonResponse(systemStateResult);
                        state = JSON.parse(cleanedResult);
                        for (const key of Object.keys(stateModel)) {
                            if (!(key in state)) {
                                state[key] = null;
                            }
                        }
                        state.system_last_message = message;
                        stateChangedProps = Object.keys(stateModel).filter(key => {
                            const prevValue = prevStateModelOnly[key];
                            const newValue = state[key];
                            return JSON.stringify(prevValue) !== JSON.stringify(newValue);
                        });
                        if (prevState.system_last_message !== message) {
                            stateChangedProps.push('system_last_message');
                        }
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to parse system state JSON: ${error.message}`, {
                            itemIndex,
                        });
                    }
                    if (stateChangedProps.length > 0) {
                        await callStateWorkflow("set", JSON.stringify(state));
                    }
                    returnData.push({
                        json: {
                            state: state,
                            prevState: prevState,
                            stateChangedProps: stateChangedProps,
                            role: role,
                            message: stateChangedProps.length > 0
                                ? `System state updated successfully. Changed fields: ${stateChangedProps.join(", ")}`
                                : "No state changes detected",
                        },
                        pairedItem: itemIndex,
                    });
                }
                else {
                    const availableToolsDesc = agentTools.map(tool => `- ${tool.name}: ${tool.description || 'No description available'}`).join("\n");
                    const stateAndToolsPrompt = prompts_1.PromptTemplate.fromTemplate(`
You are analyzing a user message to update the conversation state and determine which tools should be invoked to populate missing information.

State Model (fields to track):
{stateFields}

Current State:
{currentState}

Available Tools (name and description):
{availableTools}

User Message: {userMessage}

Instructions:
1. Analyze the user message CAREFULLY and determine the new state values based on the state model
2. CRITICAL: Only update state fields when there is CLEAR and EXPLICIT evidence in the message. Do NOT make assumptions or infer values from ambiguous content.
3. IMPORTANT extraction rules:
   - For name fields: Only extract if the user explicitly introduces themselves (e.g., "My name is John", "I'm Maria", "Call me Sarah"). Do NOT extract names from greetings (e.g., "Ola", "Hello", "Hi"), casual expressions, or single words that might be names but are actually greetings or other words in different languages.
   - For other fields: Only extract if the message contains clear, unambiguous information related to that field's description. If the message is vague, ambiguous, or doesn't contain relevant information, keep the previous value or set to null.
   - Consider context: A single word like "Ola" is a greeting in Portuguese, not a name. Only extract names when the user explicitly states their name or introduces themselves.
   - Language awareness: Be aware that words in different languages may have different meanings. A greeting in one language should not be mistaken for a name.
4. For each field in the state model, determine its current value based on the user message and previous state:
   - If the message contains clear, explicit information about the field, update it
   - If the value hasn't changed or can't be determined from the message, keep the previous value (or null if no previous value exists)
5. Identify which tools should be invoked to populate any state fields that require external data
6. For each tool that should be invoked, specify:
   - tool_name: the exact name of the tool
   - reason: why this tool should be invoked
   - state_field: which state field will be populated by this tool's result
   - input_params: the parameters to pass to the tool (as a JSON object)
7. IMPORTANT: Identify state fields that depend on tool results or other state fields and cannot be fully determined until after tools are invoked.
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
                    const stateAndToolsChain = runnables_1.RunnableSequence.from([
                        stateAndToolsPrompt,
                        llm,
                        new output_parsers_1.StringOutputParser(),
                    ]);
                    const stateAndToolsResult = await stateAndToolsChain.invoke({
                        stateFields: stateFieldDescriptions,
                        currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
                        availableTools: availableToolsDesc || "No tools available",
                        userMessage: message,
                    });
                    let toolsToInvoke = [];
                    let stateFieldsWithDependencies = new Set();
                    try {
                        const cleanedResult = AIStateHandler.cleanJsonResponse(stateAndToolsResult);
                        const parsedResult = JSON.parse(cleanedResult);
                        state = parsedResult.state || {};
                        for (const key of Object.keys(stateModel)) {
                            if (!(key in state)) {
                                state[key] = null;
                            }
                        }
                        stateChangedProps = Object.keys(stateModel).filter(key => {
                            const prevValue = prevStateModelOnly[key];
                            const newValue = state[key];
                            return JSON.stringify(prevValue) !== JSON.stringify(newValue);
                        });
                        toolsToInvoke = Array.isArray(parsedResult.tools_to_invoke) ? parsedResult.tools_to_invoke : [];
                        const fieldsNeedingPostAnalysis = parsedResult.fields_needing_post_analysis || [];
                        if (Array.isArray(fieldsNeedingPostAnalysis)) {
                            fieldsNeedingPostAnalysis.forEach((field) => {
                                if (field in stateModel) {
                                    stateFieldsWithDependencies.add(field);
                                }
                            });
                        }
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to parse state and tools JSON: ${error.message}`, {
                            itemIndex,
                        });
                    }
                    const invokedToolResults = [];
                    if (toolsToInvoke.length > 0) {
                        for (const toolInvocation of toolsToInvoke) {
                            const { tool_name, reason, input_params, state_field } = toolInvocation;
                            const tool = agentTools.find(t => t.name === tool_name || t.name.toLowerCase() === tool_name.toLowerCase());
                            if (!tool) {
                                continue;
                            }
                            try {
                                const toolResult = await tool.invoke(input_params || {});
                                invokedToolResults.push({
                                    tool_name,
                                    state_field,
                                    result: toolResult
                                });
                                let targetField = state_field;
                                if (!targetField) {
                                    if (tool_name.toLowerCase().includes('steps') || (reason === null || reason === void 0 ? void 0 : reason.toLowerCase().includes('steps'))) {
                                        targetField = 'task_steps';
                                    }
                                }
                                if (targetField && targetField in stateModel) {
                                    const parsedResult = AIStateHandler.parseToolResult(toolResult);
                                    if (JSON.stringify(state[targetField]) !== JSON.stringify(parsedResult)) {
                                        state[targetField] = parsedResult;
                                        if (!stateChangedProps.includes(targetField)) {
                                            stateChangedProps.push(targetField);
                                        }
                                    }
                                }
                            }
                            catch (error) {
                                invokedToolResults.push({
                                    tool_name,
                                    state_field,
                                    error: error.message
                                });
                            }
                        }
                    }
                    const needsPostToolAnalysis = invokedToolResults.length > 0 && stateFieldsWithDependencies.size > 0;
                    if (needsPostToolAnalysis) {
                        const toolResultsSummary = invokedToolResults.map(result => `Tool: ${result.tool_name}
Target State Field: ${result.state_field || 'not specified'}
Result: ${JSON.stringify(result.result || result.error, null, 2)}`).join('\n\n');
                        const postToolStatePrompt = prompts_1.PromptTemplate.fromTemplate(`
You are analyzing tool results to update any remaining state fields that can now be determined.

State Model (fields to track):
{stateFields}

Current State (after initial analysis and tool invocations):
{currentState}

Tool Invocation Results:
{toolResults}

User Message (for context): {userMessage}

Instructions:
1. Review the current state and tool results CAREFULLY
2. CRITICAL: Only update state fields when there is CLEAR and EXPLICIT evidence in the tool results. Do NOT make assumptions or infer values from ambiguous content.
3. Identify any state fields that are currently null/unset but can now be determined from the tool results
4. Update those fields based on the tool results and state model descriptions:
   - If the tool results contain clear, explicit information about a field, update it
   - If the information is vague, ambiguous, or doesn't match the field description, leave it as-is
5. For fields that still cannot be determined, leave them as-is
6. Return the complete updated state

Respond with ONLY a valid JSON object representing the complete state (all fields from state model):
{{
  "field1": "value1",
  "field2": "value2",
  ...
}}
`);
                        const postToolStateChain = runnables_1.RunnableSequence.from([
                            postToolStatePrompt,
                            llm,
                            new output_parsers_1.StringOutputParser(),
                        ]);
                        const postToolStateResult = await postToolStateChain.invoke({
                            stateFields: stateFieldDescriptions,
                            currentState: JSON.stringify(state, null, 2),
                            toolResults: toolResultsSummary,
                            userMessage: message,
                        });
                        try {
                            const cleanedResult = AIStateHandler.cleanJsonResponse(postToolStateResult);
                            const updatedState = JSON.parse(cleanedResult);
                            for (const key of Object.keys(stateModel)) {
                                if (key in updatedState && JSON.stringify(state[key]) !== JSON.stringify(updatedState[key])) {
                                    state[key] = updatedState[key];
                                    if (!stateChangedProps.includes(key)) {
                                        stateChangedProps.push(key);
                                    }
                                }
                            }
                        }
                        catch (error) {
                        }
                    }
                    if (stateChangedProps.length > 0) {
                        await callStateWorkflow("set", JSON.stringify(state));
                    }
                    returnData.push({
                        json: {
                            state: state,
                            prevState: prevState,
                            stateChangedProps: stateChangedProps,
                            toolsInvoked: invokedToolResults,
                            role: role,
                            message: stateChangedProps.length > 0
                                ? `State updated successfully. Changed fields: ${stateChangedProps.join(", ")}`
                                : "No state changes detected",
                        },
                        pairedItem: itemIndex,
                    });
                }
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            error: error.message,
                        },
                        error,
                        pairedItem: itemIndex
                    });
                }
                else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                        itemIndex,
                    });
                }
            }
        }
        return [returnData];
    }
}
exports.AIStateHandler = AIStateHandler;
//# sourceMappingURL=AIStateHandler.node.js.map