// This is used in react pseudoselector tests, and it's much more convenient to
// be able to put arbitrary properties on these components than to try to make everything flow.
import React from "react";
import ReactDOM from "react-dom";
import {puritan, PuritanComponent} from "react-puritan";

/* eslint-disable flowtype/require-parameter-type */
/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable react/forbid-elements */

// This is disabled because we don't want every component in here to have a
// puritan(...) wrapped display name, but we also only care about props and
// children, not actual component behavior.

// We subclass this to get a bunch of different names
/** @extends React.Component */
class BaseGroup extends PuritanComponent {
  render() {
    return this.props.children;
  }
}

const TestPortal = puritan(props =>
  ReactDOM.createPortal(props.children, document.body)
);

// These are totally pointless components that just sit in the React DOM to test
// querying when you must dig deep to get to an actual dom element

class Alpha extends BaseGroup {}
class Bravo extends BaseGroup {}
class Charlie extends BaseGroup {}
class InsideMemo extends BaseGroup {}

// TODO: Should also have an example with an arrow function. Probably will need
// a babel plugin to support this, but for now, even the react chrome extension
// can't see memo component names.
//
// A nested component is included to ensure that we can at least select inside
// memo components, if not the memo components themselves.
// [Ada Cohen @ 2018-10-26 11:22:32]
const MemoComponent = React.memo(function MemoComponent() {
  return (
    <InsideMemo>
      <div>I is memo</div>
    </InsideMemo>
  );
});

const FunctionalComponent = function FunctionalComponent({children}) {
  return <div>{children}</div>;
};

const Papa = puritan(props => props.children);

export default puritan(function ReactTestApp() {
  return (
    <>
      <Alpha frank="sinatra">
        <Bravo num={1}>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="alpha-bravo-div">First div</div>
        </Bravo>
        <Bravo num={42}>
          <Charlie duck="goose">
            {/* eslint-disable-next-line flexport/no-oocss */}
            <div className="bravo-charlie-div" key={2}>
              Second div
            </div>
            {/* eslint-disable-next-line flexport/no-oocss */}
            <div className="bravo-charlie-div" key="third">
              Third div
            </div>
          </Charlie>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="bravo-charlie-div">Fourth div</div>
        </Bravo>
        <Charlie duck="rubber">
          <div>Charlie inside sinatra</div>
        </Charlie>
      </Alpha>
      <Alpha frank="oz">
        {/* eslint-disable-next-line flexport/no-oocss */}
        <div className="alpha-div">Fifth div</div>
        <Bravo num={1}>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="alpha-bravo-div">Sixth div</div>
        </Bravo>
        {/* eslint-disable-next-line flexport/no-oocss */}
        <div className="alpha-div">
          <span>Seventh div</span>
          <Charlie duck="mallard">
            {/* eslint-disable-next-line flexport/no-oocss */}
            <div className="mallard-div">Eighth div</div>
          </Charlie>
        </div>
      </Alpha>
      <Papa douglas="crockford">
        <Bravo frank="herbert">
          <div
            onClick={() => {
              global.clickedFrankHerbert = true;
            }}
          >
            Ninth div
          </div>
        </Bravo>
      </Papa>
      <Alpha portal={true}>
        <TestPortal>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="div-in-portal">
            Now you&apos;re thinking with portals
          </div>
          <Bravo info="bravo inside portal">
            {/* eslint-disable-next-line flexport/no-oocss */}
            <div className="div-in-portal-bravo">
              The cake…
              <TestPortal>
                <Bravo>
                  {/* eslint-disable-next-line flexport/no-oocss */}
                  <span className="double-portal">…is a lie</span>
                </Bravo>
              </TestPortal>
            </div>
          </Bravo>
        </TestPortal>
      </Alpha>
      {/* eslint-disable-next-line flexport/no-oocss */}
      <div className="wrapper">
        <Alpha frank="zappa">
          {/* eslint-disable-next-line flexport/no-oocss */}
          <span className="content">Alpha zappa</span>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="bravo-wrapper">
            {/* eslint-disable-next-line flexport/no-oocss */}
            <span className="content">Bravo wrapper</span>
            <Bravo word="booooooooooooo!">
              {/* eslint-disable-next-line flexport/no-oocss */}
              <div className="bravo-inner">Bravo inner</div>
            </Bravo>
          </div>
        </Alpha>
      </div>
      <Alpha hasInput={true}>
        <h1>Here is a text field</h1>
        <input
          type="text"
          onChange={event => {
            global.changedInput = event.target.value;
          }}
        />
      </Alpha>
      <FunctionalComponent>
        <Alpha frank="ocean">
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="blep">Hi</div>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="blep">Hola</div>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="blep">Konichiwa</div>
          {/* eslint-disable-next-line flexport/no-oocss */}
          <div className="blep">Bonjour</div>
        </Alpha>
        <Bravo num={5}>
          <p>Hello world</p>
        </Bravo>
      </FunctionalComponent>
      <FunctionalComponent type="simple">This is an SFC</FunctionalComponent>
      <FunctionalComponent type="simple">
        This is a second SFC
      </FunctionalComponent>
      <FunctionalComponent type="simple">
        This is a third SFC
      </FunctionalComponent>
      {/* Need a functional component inside a portal, which is otherwise similar to the previous two */}
      <TestPortal>
        <FunctionalComponent type="simple">
          This is an SFC inside a portal
        </FunctionalComponent>
      </TestPortal>
      <MemoComponent />
    </>
  );
});
