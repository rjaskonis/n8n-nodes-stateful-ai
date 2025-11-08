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
                    displayName: 'State',
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
                    description: 'The role of the message sender. User messages trigger full analysis with tools, System messages directly update state.',
                },
                {
                    displayName: 'Message',
                    name: 'message',
                    type: 'string',
                    default: '',
                    required: true,
                    typeOptions: {
                        rows: 4,
                    },
                    description: 'The message to process for state updates',
                },
                {
                    displayName: 'State Model',
                    name: 'stateModel',
                    type: 'json',
                    default: '',
                    required: true,
                    placeholder: '{\n  "field_name": "Description of what this field tracks"\n}',
                    description: 'JSON object defining the state fields to track. Each key is a field name and value is its description.',
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
                let stateManagementTool = null;
                try {
                    const stateConnection = await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiTool, 0);
                    if (stateConnection) {
                        stateManagementTool = Array.isArray(stateConnection) ? stateConnection[0] : stateConnection;
                    }
                }
                catch (error) {
                    stateManagementTool = null;
                }
                if (!stateManagementTool) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'State Management Tool is required but not connected', {
                        itemIndex,
                    });
                }
                let agentTools = [];
                try {
                    const toolsConnection = await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiTool, 1);
                    if (toolsConnection) {
                        agentTools = Array.isArray(toolsConnection) ? toolsConnection : [toolsConnection];
                    }
                }
                catch (error) {
                    agentTools = [];
                }
                const stateManagementResponse = await stateManagementTool.invoke({
                    operation: "get",
                    content: ""
                });
                const parsedResponse = JSON.parse(stateManagementResponse);
                const previousStateData = Array.isArray(parsedResponse) ? parsedResponse[0] : parsedResponse;
                const prevState = previousStateData || {};
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
                        await stateManagementTool.invoke({
                            operation: "set",
                            content: JSON.stringify(state),
                        });
                    }
                    returnData.push({
                        json: {
                            state: state,
                            prevState: prevState,
                            stateChangedProps: stateChangedProps,
                            role: role,
                            message: stateChangedProps.length > 0
                                ? `System state updated successfully. Changed fields: ${stateChangedProps.join(", ")}`
                                : "No state changes detected"
                        },
                        pairedItem: itemIndex,
                    });
                }
                else {
                    const availableToolsDesc = agentTools.map(tool => {
                        return `- ${tool.name}: ${tool.description || 'No description available'}`;
                    }).join("\n");
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
                        toolsToInvoke = parsedResult.tools_to_invoke || [];
                        if (!Array.isArray(toolsToInvoke)) {
                            toolsToInvoke = [];
                        }
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
                        const toolResultsSummary = invokedToolResults.map(result => {
                            return `Tool: ${result.tool_name}
Target State Field: ${result.state_field || 'not specified'}
Result: ${JSON.stringify(result.result || result.error, null, 2)}`;
                        }).join('\n\n');
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
                        await stateManagementTool.invoke({
                            operation: "set",
                            content: JSON.stringify(state),
                        });
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
                                : "No state changes detected"
                        },
                        pairedItem: itemIndex,
                    });
                }
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error.message },
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