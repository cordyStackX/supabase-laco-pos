import React from "react";
import { Route, Redirect } from "react-router-dom";
import { getToken } from "../lib/api";

/**
 * Client-side guard for UX only. The real authorization check is the server's:
 * every API call carries the bearer token and each route validates it, so
 * editing localStorage can at worst reveal an empty page, never data.
 */
const PrivateRoute = ({ component: Component, ...rest }) => {
  const authenticated = Boolean(getToken());

  return (
    <Route
      {...rest}
      render={(props) =>
        authenticated ? <Component {...props} /> : <Redirect to={{ pathname: "/" }} />
      }
    />
  );
};

export default PrivateRoute;
